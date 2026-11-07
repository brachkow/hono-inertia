import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { inertia } from '../src/middleware.js';
import { optional } from '../src/properties.js';
import type { InertiaConfig, PageObject } from '../src/types.js';

const INERTIA = { 'X-Inertia': 'true' };
const SSR_BODY = '<div id="app">ssr</div>';
const FLAG_COOKIE = /^app_clear_history=1; Max-Age=60; Path=\/app;/;

const ssrRender = () => vi.fn(() => ({ head: [], body: SSR_BODY }));

const getPage = async (response: Response) =>
  (await response.json()) as PageObject;

describe('ssr.enabled', () => {
  it('turns SSR off for requests a function rejects', async () => {
    const render = ssrRender();
    const app = new Hono()
      .use(
        inertia({
          ssr: { render, enabled: (c) => !c.req.path.startsWith('/admin') },
        }),
      )
      .get('/admin', (c) => c.var.inertia.render('Admin'));

    await app.request('/admin');

    expect(render).not.toHaveBeenCalled();
  });

  it('keeps SSR on for requests a function accepts', async () => {
    const render = ssrRender();
    const app = new Hono()
      .use(inertia({ ssr: { render, enabled: () => Promise.resolve(true) } }))
      .get('/', (c) => c.var.inertia.render('Home'));

    const response = await app.request('/');
    const html = await response.text();

    expect(html).toContain(SSR_BODY);
  });
});

describe('c.var.inertia.ssr()', () => {
  it('turns SSR off for one response', async () => {
    const render = ssrRender();
    const app = new Hono().use(inertia({ ssr: { render } })).get('/', (c) => {
      c.var.inertia.ssr(false);
      return c.var.inertia.render('Home');
    });

    await app.request('/');

    expect(render).not.toHaveBeenCalled();
  });

  it('turns SSR on where the config turns it off', async () => {
    const render = ssrRender();
    const app = new Hono()
      .use(inertia({ ssr: { render, enabled: false } }))
      .get('/', (c) => {
        c.var.inertia.ssr();
        return c.var.inertia.render('Home');
      });

    await app.request('/');

    expect(render).toHaveBeenCalledOnce();
  });
});

describe('ssr.fetch', () => {
  it('sends the SSR request through it', async () => {
    const fetch = vi.fn((request: Request) =>
      Promise.resolve(
        Response.json({ head: [], body: `<p>${request.url}</p>` }),
      ),
    );
    const app = new Hono()
      .use(inertia({ ssr: { url: 'http://ssr.internal', fetch } }))
      .get('/', (c) => c.var.inertia.render('Home'));

    const response = await app.request('/');
    const html = await response.text();

    expect(html).toContain('<p>http://ssr.internal/render</p>');
  });
});

describe('allErrors', () => {
  const createApp = (config: InertiaConfig) =>
    new Hono().use(inertia(config)).get('/', (c) => {
      c.var.inertia.withErrors({ email: ['Too short', 'Not an email'] });
      return c.var.inertia.render('Form');
    });

  it('gives pages every message per field', async () => {
    const app = createApp({ allErrors: true });

    const page = await getPage(await app.request('/', { headers: INERTIA }));

    expect(page.props.errors).toEqual({
      email: ['Too short', 'Not an email'],
    });
  });

  it('gives pages the first message by default', async () => {
    const app = createApp({});

    const page = await getPage(await app.request('/', { headers: INERTIA }));

    expect(page.props.errors).toEqual({ email: 'Too short' });
  });

  it('keeps every message across a redirect', async () => {
    const app = new Hono()
      .use(inertia({ allErrors: true, session: { secret: 'x'.repeat(32) } }))
      .post('/form', (c) => {
        c.var.inertia.withErrors({ email: ['Too short', 'Not an email'] });
        return c.redirect('/form');
      })
      .get('/form', (c) => c.var.inertia.render('Form'));

    const redirect = await app.request('/form', { method: 'POST' });
    const cookie = redirect.headers.get('Set-Cookie')?.split(';')[0] ?? '';
    const page = await getPage(
      await app.request('/form', { headers: { ...INERTIA, Cookie: cookie } }),
    );

    expect(page.props.errors).toEqual({
      email: ['Too short', 'Not an email'],
    });
  });
});

describe('transformComponent', () => {
  const createApp = () =>
    new Hono()
      .use(inertia({ transformComponent: (name) => `pages/${name}` }))
      .get('/', (c) =>
        c.var.inertia.render('Home', { stats: optional(() => 1) }),
      );

  it('sends the transformed name', async () => {
    const page = await getPage(
      await createApp().request('/', { headers: INERTIA }),
    );

    expect(page.component).toBe('pages/Home');
  });

  it('matches partial reloads against the transformed name', async () => {
    const page = await getPage(
      await createApp().request('/', {
        headers: {
          ...INERTIA,
          'X-Inertia-Partial-Component': 'pages/Home',
          'X-Inertia-Partial-Data': 'stats',
        },
      }),
    );

    expect(page.props.stats).toBe(1);
  });
});

describe('flagCookies', () => {
  it('names and scopes the flag cookies', async () => {
    const app = new Hono()
      .use(inertia({ flagCookies: { prefix: 'app_', path: '/app' } }))
      .post('/logout', (c) => {
        c.var.inertia.clearHistory();
        return c.redirect('/');
      });

    const response = await app.request('/logout', { method: 'POST' });

    expect(response.headers.get('Set-Cookie')).toMatch(FLAG_COOKIE);
  });

  it('reads a flag from a cookie with the prefix', async () => {
    const app = new Hono()
      .use(inertia({ flagCookies: { prefix: 'app_' } }))
      .get('/', (c) => c.var.inertia.render('Home'));

    const page = await getPage(
      await app.request('/', {
        headers: { ...INERTIA, Cookie: 'app_clear_history=1' },
      }),
    );

    expect(page.clearHistory).toBe(true);
  });
});

describe('a render that throws', () => {
  it('keeps the flash data for the next page', async () => {
    const app = new Hono()
      .use(inertia({ session: { secret: 'x'.repeat(32) } }))
      .post('/save', (c) => {
        c.var.inertia.flash({ message: 'Saved' });
        return c.redirect('/broken');
      })
      .get('/broken', (c) =>
        c.var.inertia.render('Broken', {
          data: () => {
            throw new Error('database down');
          },
        }),
      )
      .get('/', (c) => c.var.inertia.render('Home'));

    const redirect = await app.request('/save', { method: 'POST' });
    const cookie = redirect.headers.get('Set-Cookie')?.split(';')[0] ?? '';
    const broken = await app.request('/broken', {
      headers: { ...INERTIA, Cookie: cookie },
    });
    const page = await getPage(
      await app.request('/', { headers: { ...INERTIA, Cookie: cookie } }),
    );

    expect({ status: broken.status, flash: page.flash }).toEqual({
      status: 500,
      flash: { message: 'Saved' },
    });
  });
});
