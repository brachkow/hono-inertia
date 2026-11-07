import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { inertia } from '../src/middleware.js';
import { deferred } from '../src/properties.js';
import { serializePage } from '../src/serialize.js';
import { getPage, inertiaHeaders, inertiaRequest } from '../src/testing.js';
import type { InertiaEnv } from '../src/types.js';

function createApp() {
  const app = new Hono<InertiaEnv>();
  app.use(
    inertia({
      version: '1.0',
      render: (page) =>
        `<!DOCTYPE html><html><body><script data-page="app" type="application/json">${serializePage(page)}</script><div id="app"></div></body></html>`,
    }),
  );
  app.get('/users', (c) =>
    c.var.inertia.render('Users/Index', {
      users: ['Ada', 'Grace'],
      stats: deferred(() => ({ total: 2 })),
    }),
  );
  return app;
}

describe('inertiaHeaders()', () => {
  it('sends X-Inertia by default', () => {
    expect(inertiaHeaders()).toEqual({ 'X-Inertia': 'true' });
  });

  it('leaves X-Inertia out for a plain browser request', () => {
    expect(inertiaHeaders({ inertia: false })).toEqual({});
  });

  it('builds the partial reload headers', () => {
    expect(
      inertiaHeaders({
        partial: { component: 'Users/Index', only: ['users', 'stats'] },
      }),
    ).toMatchObject({
      'X-Inertia-Partial-Component': 'Users/Index',
      'X-Inertia-Partial-Data': 'users,stats',
    });
  });

  it('builds the version, reset, error bag and once headers', () => {
    expect(
      inertiaHeaders({
        version: '2.0',
        reset: ['feed'],
        errorBag: 'login',
        exceptOnceProps: ['plans'],
      }),
    ).toMatchObject({
      'X-Inertia-Version': '2.0',
      'X-Inertia-Reset': 'feed',
      'X-Inertia-Error-Bag': 'login',
      'X-Inertia-Except-Once-Props': 'plans',
    });
  });

  it('lets explicit headers win', () => {
    expect(inertiaHeaders({ headers: { 'X-Inertia': 'false' } })).toEqual({
      'X-Inertia': 'false',
    });
  });
});

describe('inertiaRequest()', () => {
  it('gets the JSON page of an Inertia visit', async () => {
    const app = createApp();

    const response = await inertiaRequest(app, '/users');

    expect(response.headers.get('X-Inertia')).toBe('true');
  });

  it('fetches deferred props with a partial reload', async () => {
    const app = createApp();

    const page = await getPage(
      await inertiaRequest(app, '/users', {
        partial: { component: 'Users/Index', only: ['stats'] },
      }),
    );

    expect(page.props).toEqual({ errors: {}, stats: { total: 2 } });
  });

  it('sends a JSON body', async () => {
    const app = createApp();
    app.post('/echo', async (c) => c.json(await c.req.json()));

    const response = await inertiaRequest(app, '/echo', {
      method: 'POST',
      json: { name: 'Ada' },
    });

    expect(await response.json()).toEqual({ name: 'Ada' });
  });

  it('gets a 409 when the version is stale', async () => {
    const app = createApp();

    const response = await inertiaRequest(app, '/users', { version: 'old' });

    expect(response.status).toBe(409);
  });
});

describe('getPage()', () => {
  it('reads the page from an Inertia JSON response', async () => {
    const app = createApp();

    const page = await getPage(await inertiaRequest(app, '/users'));

    expect(page.component).toBe('Users/Index');
    expect(page.deferredProps).toEqual({ default: ['stats'] });
  });

  it('reads the page from the HTML of a first visit', async () => {
    const app = createApp();

    const page = await getPage(
      await inertiaRequest(app, '/users', { inertia: false }),
    );

    expect(page.props.users).toEqual(['Ada', 'Grace']);
  });

  it('reads props that hold characters serializePage escapes', async () => {
    const app = createApp();
    app.get('/xss', (c) =>
      c.var.inertia.render('Xss', { name: '</script><b>' }),
    );

    const page = await getPage(
      await inertiaRequest(app, '/xss', { inertia: false }),
    );

    expect(page.props.name).toBe('</script><b>');
  });

  it('throws for a response that is not a page', async () => {
    const app = createApp();
    app.get('/health', (c) => c.text('ok'));

    await expect(getPage(await inertiaRequest(app, '/health'))).rejects.toThrow(
      'is not an Inertia page',
    );
  });
});
