import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { inertia } from '../src/middleware.js';
import type { InertiaAssets, InertiaConfig } from '../src/types.js';

const assets: InertiaAssets = {
  version: 'v1',
  assetTagsFor: (component) => `<script src="/${component}.js"></script>`,
};

const DOCUMENT_START =
  /^<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">/;

const createApp = (config: InertiaConfig) =>
  new Hono()
    .use(inertia(config))
    .get('/', (c) => c.var.inertia.render('Home', { name: 'Ada' }))
    .post('/save', (c) => {
      c.var.inertia.flash({ message: 'Saved' });
      return c.redirect('/');
    });

const firstVisit = async (config: InertiaConfig) => {
  const response = await createApp(config).request('/');
  return response.text();
};

describe('default template', () => {
  it('renders the page in a data-page script and an empty root', async () => {
    const html = await firstVisit({ assets });

    expect(html).toContain(
      '<body><script data-page="app" type="application/json">{"component":"Home"',
    );
    expect(html).toContain('</script><div id="app"></div></body>');
  });

  it("adds the rendered page's asset tags to the head", async () => {
    const html = await firstVisit({ assets });

    expect(html).toContain('<script src="/Home.js"></script></head>');
  });

  it('sets charset and viewport', async () => {
    const html = await firstVisit({ assets });

    expect(html).toMatch(DOCUMENT_START);
  });

  it('takes lang, title, head and id from template', async () => {
    const html = await firstVisit({
      assets,
      template: {
        lang: 'en',
        title: 'Tom & Jerry',
        head: '<link rel="icon" href="/icon.svg">',
        id: 'root',
      },
    });

    expect({
      lang: html.includes('<html lang="en">'),
      title: html.includes('<title>Tom &amp; Jerry</title>'),
      head: html.includes('<link rel="icon" href="/icon.svg">'),
      id: html.includes('data-page="root"') && html.includes('id="root"'),
    }).toEqual({ lang: true, title: true, head: true, id: true });
  });

  it('calls a head function with the page', async () => {
    const html = await firstVisit({
      assets,
      template: {
        head: (page) => `<meta name="page" content="${page.component}">`,
      },
    });

    expect(html).toContain('<meta name="page" content="Home">');
  });

  it('renders the SSR head and body', async () => {
    const html = await firstVisit({
      assets: {
        ...assets,
        ssr: () =>
          Promise.resolve({
            head: ['<title>From SSR</title>'],
            body: '<div id="app">rendered</div>',
          }),
      },
      template: { title: 'Fallback' },
    });

    expect({
      ssrTitle: html.includes('<title>From SSR</title>'),
      fallbackTitle: html.includes('<title>Fallback</title>'),
      body: html.includes('<body><div id="app">rendered</div></body>'),
    }).toEqual({ ssrTitle: true, fallbackTitle: false, body: true });
  });

  it('gives way to a render option', async () => {
    const html = await firstVisit({ assets, render: () => '<p>custom</p>' });

    expect(html).toBe('<p>custom</p>');
  });

  it('works without assets', async () => {
    const html = await firstVisit({});

    expect(html).toContain('<div id="app"></div>');
  });
});

describe('assets', () => {
  it('gives the version', async () => {
    const response = await createApp({ assets }).request('/', {
      headers: { 'X-Inertia': 'true', 'X-Inertia-Version': 'old' },
    });

    expect(response.status).toBe(409);
  });

  it('gives way to a version option', async () => {
    const response = await createApp({ assets, version: 'v2' }).request('/', {
      headers: { 'X-Inertia': 'true' },
    });
    const page = (await response.json()) as { version: string };

    expect(page.version).toBe('v2');
  });

  it('gives way to an ssr option', async () => {
    const html = await firstVisit({
      assets: {
        ...assets,
        ssr: () => Promise.resolve({ head: [], body: '<p>assets</p>' }),
      },
      ssr: {
        render: () => ({ head: [], body: '<p>option</p>' }),
      },
    });

    expect(html).toContain('<p>option</p>');
  });
});

describe('session options', () => {
  it('creates a cookie session from its options', async () => {
    const app = createApp({ assets, session: { secret: 'x'.repeat(32) } });

    const redirect = await app.request('/save', { method: 'POST' });
    const cookie = redirect.headers.get('Set-Cookie')?.split(';')[0] ?? '';
    const page = await app.request('/', {
      headers: { 'X-Inertia': 'true', Cookie: cookie },
    });

    expect(((await page.json()) as { flash?: unknown }).flash).toEqual({
      message: 'Saved',
    });
  });
});
