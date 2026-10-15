import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import {
  deferred,
  inertia,
  merge,
  optional,
  serializePage,
} from '@brachkow/hono-inertia';
import type { InertiaEnvironment, SsrConfig } from '@brachkow/hono-inertia';
import type { Page } from '@inertiajs/core';
import { manifestVersion } from '@brachkow/hono-inertia/vite';

type Manifest = Record<string, { file: string; css?: string[] }>;

const CLIENT_ENTRY = 'src/client.ts';
// Must match SSR_PORT in src/ssr.ts
const SSR_URL = 'http://127.0.0.1:13716';
const FLASH_COOKIE = 'flash';
const PAGE_SIZE = 3;

const USERS = [
  'Ada Lovelace',
  'Alan Turing',
  'Grace Hopper',
  'Edsger Dijkstra',
  'Barbara Liskov',
  'Donald Knuth',
  'Margaret Hamilton',
  'Ken Thompson',
  'Frances Allen',
].map((name, index) => ({ id: index + 1, name }));

// In production the client manifest is bundled into the server. The glob
// matches nothing in dev, where Vite serves the client itself.
const manifest = import.meta.env.PROD
  ? Object.values(
      import.meta.glob<Manifest>('../dist/client/.vite/manifest.json', {
        eager: true,
        import: 'default',
      }),
    )[0]
  : undefined;

const assetTags = manifest
  ? [
      `<script type="module" src="/${manifest[CLIENT_ENTRY].file}"></script>`,
      ...(manifest[CLIENT_ENTRY].css ?? []).map(
        (file) => `<link rel="stylesheet" href="/${file}">`,
      ),
    ].join('')
  : `<script type="module" src="/@vite/client"></script><script type="module" src="/${CLIENT_ENTRY}"></script>`;

// Production posts pages to the SSR server that `start:ssr` runs. Dev renders
// in-process: Vite loads src/ssr.ts with hot reload, so no second process.
const ssr: SsrConfig = import.meta.env.PROD
  ? { url: SSR_URL }
  : {
      render: async (page) => {
        const { default: renderPage } = await import('./ssr');
        // Inertia's Page type also requires client-only state (rememberedState)
        // that no server sends
        return renderPage(page as Page);
      },
    };

const app = new Hono<InertiaEnvironment>();

app.use(
  inertia({
    version: manifest ? manifestVersion(manifest) : 'dev',
    ssr,
    share: () => ({ appName: 'Vue + Node' }),
    render: (page, _viewData, ssrResult) =>
      ssrResult
        ? `<!DOCTYPE html><html><head><meta charset="utf-8">${ssrResult.head}${assetTags}</head><body>${ssrResult.body}</body></html>`
        : `<!DOCTYPE html><html><head><meta charset="utf-8">${assetTags}</head><body><script data-page="app" type="application/json">${serializePage(page)}</script><div id="app"></div></body></html>`,
  }),
);

// The adapter has no session, so flash data survives the POST → redirect →
// GET round trip in a short-lived cookie.
app.use(async (c, next) => {
  const flash = getCookie(c, FLASH_COOKIE);
  if (flash) {
    deleteCookie(c, FLASH_COOKIE);
    c.var.inertia.flash(JSON.parse(flash) as Record<string, unknown>);
  }
  await next();
});

app.get('/', (c) => c.var.inertia.render('Home', { framework: 'Vue' }));

app.get('/users', (c) => {
  const page = Number(c.req.query('page') ?? 1);
  const start = (page - 1) * PAGE_SIZE;
  return c.var.inertia.render('Users/Index', {
    // Appended to the list already on screen when "Load more" reloads it
    users: merge(() => USERS.slice(start, start + PAGE_SIZE)),
    page,
    hasMore: start + PAGE_SIZE < USERS.length,
    // Only sent when a partial reload asks for it
    stats: optional(() => ({ total: USERS.length })),
    // Sent in a follow-up request after the page renders
    activity: deferred(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return ['Ada signed in', 'Alan updated his profile'];
    }),
  });
});

app.get('/contact', (c) => c.var.inertia.render('Contact'));

app.post('/contact', async (c) => {
  // Inertia forms submit JSON
  const body = await c.req.json<{ name?: unknown }>();
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name === '') {
    return c.var.inertia.render('Contact', {
      errors: { name: 'Name is required' },
    });
  }
  setCookie(c, FLASH_COOKIE, JSON.stringify({ message: `Thanks, ${name}` }), {
    httpOnly: true,
    maxAge: 60,
    path: '/',
    sameSite: 'Lax',
  });
  return c.redirect('/');
});

export default app;
