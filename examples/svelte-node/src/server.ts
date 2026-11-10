import { Hono } from 'hono';
import { z } from 'zod';
import {
  deferred,
  inertia,
  inertiaValidator,
  live,
  merge,
  optional,
} from '@brachkow/hono-inertia';
import * as assets from 'virtual:hono-inertia/assets';

const PAGE_SIZE = 3;

// Signs the session cookie that carries errors and flash messages across
// redirects. Anyone can read this fallback, and with it forge those messages,
// so set SESSION_SECRET in production.
const INSECURE_EXAMPLE_SECRET = 'example-only-secret-set-SESSION_SECRET';

// One schema checks the submitted form and the fields precognition asks about
const contactSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  email: z.email('Enter a valid email'),
});

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
      // The version, the asset tags and the SSR entry from honoInertia() in
      // vite.config.ts. inertia() renders the HTML page with them, and SSR
      // runs in this process.
      assets,
      share: () => ({ appName: 'Svelte + Node' }),
      // Signs the built-in cookie session
      session: {
        secret: process.env.SESSION_SECRET ?? INSECURE_EXAMPLE_SECRET,
      },
    }),
  )
  .get('/', (c) => c.var.inertia.render('Home', { framework: 'Svelte' }))
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
  // Reloaded by the client when TokenRotated arrives on the tokens channel
  .get('/live', (c) =>
    c.var.inertia.render('Live', {
      token: live(() => crypto.randomUUID(), {
        channel: 'tokens',
        on: 'TokenRotated',
      }),
    }),
  )
  .get('/contact', (c) => c.var.inertia.render('Contact'))
  // A failed submit goes back to the form with the errors, and a precognition
  // request gets its answer without reaching the handler
  .post('/contact', inertiaValidator('json', contactSchema), (c) => {
    const { name } = c.req.valid('json');
    c.var.inertia.flash({ message: `Thanks, ${name}` });
    return c.redirect('/');
  });

export default app;
