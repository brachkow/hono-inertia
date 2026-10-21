import { Hono } from 'hono';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { inertia } from '../src/middleware.js';
import {
  always,
  deferred,
  merge,
  once,
  optional,
  scroll,
} from '../src/properties.js';
import type { PagePropsFor } from '../src/page-properties.js';
import type { PageObject, ScrollMetadata } from '../src/types.js';

// Each test checks a PageProps type, which `pnpm typecheck` verifies, and the
// props a first visit receives at runtime, which should fit that type.

type Errors = Record<string, string> & Record<string, Record<string, string>>;

const render = () => '';
const USERS = [{ id: 1 }];
const metadata: ScrollMetadata = {
  getPageName: () => 'page',
  getCurrentPage: () => 1,
  getPreviousPage: () => null,
  getNextPage: () => null,
};

interface App {
  request: (path: string, init: RequestInit) => Response | Promise<Response>;
}

const firstVisitProperties = async (app: App, path: string) => {
  const response = await app.request(path, {
    headers: { 'X-Inertia': 'true' },
  });
  const page = (await response.json()) as PageObject;
  return page.props;
};

describe('PageProps', () => {
  it('reads plain props from the route that renders the page', async () => {
    const app = new Hono()
      .use(inertia({ render }))
      .get('/', (c) => c.var.inertia.render('Home', { framework: 'React' }));

    expectTypeOf<PagePropsFor<typeof app, 'Home'>>().toEqualTypeOf<{
      framework: string;
      errors: Errors;
    }>();
    expect(await firstVisitProperties(app, '/')).toEqual({
      framework: 'React',
      errors: {},
    });
  });

  it('resolves lazy props and prop wrappers to their values', async () => {
    const app = new Hono().use(inertia({ render })).get('/users', (c) =>
      c.var.inertia.render('Users', {
        count: () => USERS.length,
        users: merge(() => Promise.resolve(USERS)),
        page: always(1),
        plan: once(() => 'pro'),
        feed: scroll(() => ['post'], metadata),
      }),
    );

    expectTypeOf<PagePropsFor<typeof app, 'Users'>>().toEqualTypeOf<{
      count: number;
      users: Array<{ id: number }>;
      page: number;
      plan: string;
      feed: string[];
      errors: Errors;
    }>();
    expect(await firstVisitProperties(app, '/users')).toEqual({
      count: 1,
      users: [{ id: 1 }],
      page: 1,
      plan: 'pro',
      feed: ['post'],
      errors: {},
    });
  });

  it('marks optional and deferred props as possibly missing', async () => {
    const app = new Hono().use(inertia({ render })).get('/users', (c) =>
      c.var.inertia.render('Users', {
        stats: optional(() => ({ total: 9 })),
        activity: deferred(() => Promise.resolve(['signed in'])).merge(),
      }),
    );

    expectTypeOf<PagePropsFor<typeof app, 'Users'>>().toEqualTypeOf<{
      stats?: { total: number };
      activity?: string[];
      errors: Errors;
    }>();
    expect(await firstVisitProperties(app, '/users')).toEqual({ errors: {} });
  });

  it('adds what share() returns, letting page props win', async () => {
    const app = new Hono()
      .use(
        inertia({
          render,
          share: () => Promise.resolve({ appName: 'Demo', locale: 'en' }),
        }),
      )
      .get('/', (c) => c.var.inertia.render('Home', { locale: 1 }));

    expectTypeOf<PagePropsFor<typeof app, 'Home'>>().toEqualTypeOf<{
      appName: string;
      locale: number;
      errors: Errors;
    }>();
    expect(await firstVisitProperties(app, '/')).toEqual({
      appName: 'Demo',
      locale: 1,
      errors: {},
    });
  });

  it('gives a union when routes render a page with different props', async () => {
    const app = new Hono()
      .use(inertia({ render }))
      .get('/contact', (c) => c.var.inertia.render('Contact'))
      .get('/contact/sent', (c) =>
        c.var.inertia.render('Contact', { sent: true }),
      );

    expectTypeOf<PagePropsFor<typeof app, 'Contact'>>().toEqualTypeOf<
      { sent?: undefined; errors: Errors } | { sent: boolean; errors: Errors }
    >();
    expect(await firstVisitProperties(app, '/contact')).toEqual({ errors: {} });
    expect(await firstVisitProperties(app, '/contact/sent')).toEqual({
      sent: true,
      errors: {},
    });
  });

  it('ignores routes that do not render a page', async () => {
    const app = new Hono()
      .use(inertia({ render }))
      .get('/', (c) => c.var.inertia.render('Home', { ok: true }))
      .get('/health', (c) => c.json({ ok: 'yes' }))
      .post('/logout', (c) => c.redirect('/'));

    expectTypeOf<PagePropsFor<typeof app, 'Home'>>().toEqualTypeOf<{
      ok: boolean;
      errors: Errors;
    }>();
    // @ts-expect-error no route renders 'Missing'
    expectTypeOf<PagePropsFor<typeof app, 'Missing'>>();
    expect(await firstVisitProperties(app, '/')).toEqual({
      ok: true,
      errors: {},
    });
  });
});
