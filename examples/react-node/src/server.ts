import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import {
  deferred,
  inertia,
  merge,
  optional,
  serializePage,
} from '@brachkow/hono-inertia';
import { assetTags, version } from 'virtual:hono-inertia/assets';
import renderPage from './ssr';

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

// Routes are chained so the app's type records what each one renders.
// src/pages.gen.ts reads it to type every page's props (see PageProps).
const app = new Hono()
  .use(
    inertia({
      // Both come from honoInertia() in vite.config.ts
      version,
      // Renders in this process. No separate SSR server to run
      ssr: { render: renderPage },
      share: () => ({ appName: 'React + Node' }),
      render: (page, _viewData, ssrResult) =>
        ssrResult
          ? `<!DOCTYPE html><html><head><meta charset="utf-8">${ssrResult.head}${assetTags}</head><body>${ssrResult.body}</body></html>`
          : `<!DOCTYPE html><html><head><meta charset="utf-8">${assetTags}</head><body><script data-page="app" type="application/json">${serializePage(page)}</script><div id="app"></div></body></html>`,
    }),
  )
  // The adapter has no session, so flash data survives the POST → redirect →
  // GET round trip in a short-lived cookie.
  .use(async (c, next) => {
    const flash = getCookie(c, FLASH_COOKIE);
    if (flash) {
      deleteCookie(c, FLASH_COOKIE);
      c.var.inertia.flash(JSON.parse(flash) as Record<string, unknown>);
    }
    await next();
  })
  .get('/', (c) => c.var.inertia.render('Home', { framework: 'React' }))
  .get('/users', (c) => {
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
  })
  .get('/contact', (c) => c.var.inertia.render('Contact'))
  .post('/contact', async (c) => {
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
