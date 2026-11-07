import { Hono } from 'hono';
import type { Context } from 'hono';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { inertia, inertiaShare } from '../src/middleware.js';
import {
  always,
  deferred,
  merge,
  once,
  optional,
  scroll,
} from '../src/properties.js';
import type {
  MissingVuePagePropsFor,
  PagePropsFor,
  SharedProps,
} from '../src/page-properties.js';
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

  it('types share from the app Env its context is annotated with', async () => {
    interface SessionEnvironment {
      Variables: { session: { user: string } };
    }
    const app = new Hono<SessionEnvironment>()
      .use(async (c, next) => {
        c.set('session', { user: 'Ada' });
        await next();
      })
      .use(
        inertia({
          render,
          share: (c: Context<SessionEnvironment>) => ({
            user: c.get('session').user,
          }),
        }),
      )
      .get('/', (c) => c.var.inertia.render('Home'));

    expectTypeOf<PagePropsFor<typeof app, 'Home'>>().toEqualTypeOf<{
      user: string;
      errors: Errors;
    }>();
    expect(await firstVisitProperties(app, '/')).toEqual({
      user: 'Ada',
      errors: {},
    });
  });

  it('adds what inertiaShare() shares after the middleware', async () => {
    const app = new Hono()
      .use(inertia({ render }))
      .use(inertiaShare(() => ({ locale: 'en' })))
      .get('/', (c) => c.var.inertia.render('Home', { framework: 'Vue' }));

    expectTypeOf<PagePropsFor<typeof app, 'Home'>>().toEqualTypeOf<{
      locale: string;
      framework: string;
      errors: Errors;
    }>();
    expect(await firstVisitProperties(app, '/')).toEqual({
      locale: 'en',
      framework: 'Vue',
      errors: {},
    });
  });

  it('merges inertiaShare() with the share option', async () => {
    const app = new Hono()
      .use(inertia({ render, share: () => ({ appName: 'Demo' }) }))
      .use(inertiaShare(() => ({ locale: 'en' })))
      .get('/', (c) => c.var.inertia.render('Home'));

    expectTypeOf<PagePropsFor<typeof app, 'Home'>>().toEqualTypeOf<{
      appName: string;
      locale: string;
      errors: Errors;
    }>();
    expect(await firstVisitProperties(app, '/')).toEqual({
      appName: 'Demo',
      locale: 'en',
      errors: {},
    });
  });

  it('keeps typed shared props next to an untyped share option', async () => {
    const untyped = (): Record<string, unknown> => ({ anything: true });
    const app = new Hono()
      .use(inertia({ render, share: untyped }))
      .use(inertiaShare(() => ({ locale: 'en' })))
      .get('/', (c) => c.var.inertia.render('Home'));

    expectTypeOf<PagePropsFor<typeof app, 'Home'>>().toEqualTypeOf<{
      locale: string;
      errors: Errors;
    }>();
    expect(await firstVisitProperties(app, '/')).toEqual({
      anything: true,
      locale: 'en',
      errors: {},
    });
  });

  it('reads earlier middlewares through an annotated context', async () => {
    interface SessionEnvironment {
      Variables: { session: { user: string } };
    }
    const app = new Hono<SessionEnvironment>()
      .use(inertia({ render }))
      .use(async (c, next) => {
        c.set('session', { user: 'Ada' });
        await next();
      })
      .use(
        inertiaShare((c: Context<SessionEnvironment>) => ({
          user: c.get('session').user,
        })),
      )
      .get('/', (c) => c.var.inertia.render('Home'));

    expectTypeOf<PagePropsFor<typeof app, 'Home'>>().toEqualTypeOf<{
      user: string;
      errors: Errors;
    }>();
    expect(await firstVisitProperties(app, '/')).toEqual({
      user: 'Ada',
      errors: {},
    });
  });

  it('shares nothing when inertiaShare() returns undefined', async () => {
    const app = new Hono()
      .use(inertia({ render }))
      .use(
        inertiaShare((c) =>
          c.req.path.startsWith('/assets') ? undefined : { locale: 'en' },
        ),
      )
      .get('/assets/page', (c) => c.var.inertia.render('Home'));

    expect(await firstVisitProperties(app, '/assets/page')).toEqual({
      errors: {},
    });
  });

  it('fails when inertiaShare() runs before inertia()', async () => {
    const app = new Hono()
      .use(inertiaShare(() => ({ locale: 'en' })))
      .get('/', (c) => c.text('ok'));

    const response = await app.request('/');

    expect(response.status).toBe(500);
  });

  it('gives the shared props without errors as SharedProps', async () => {
    const app = new Hono()
      .use(inertia({ render, share: () => ({ appName: 'Demo' }) }))
      .use(inertiaShare(() => ({ locale: 'en' })))
      .get('/', (c) => c.var.inertia.render('Home'));

    expectTypeOf<SharedProps<typeof app>>().toEqualTypeOf<{
      appName: string;
      locale: string;
    }>();
    expect(await firstVisitProperties(app, '/')).toEqual({
      appName: 'Demo',
      locale: 'en',
      errors: {},
    });
  });

  it('types props as JSON sends them', async () => {
    const createdAt = new Date('2026-01-02T03:04:05.000Z');
    const money = { toJSON: () => 12.5 };
    const device = (): string | undefined => 'phone';
    const app = new Hono().use(inertia({ render })).get('/', (c) =>
      c.var.inertia.render('Settings', {
        sessions: [{ createdAt, device: device() }],
        price: money,
        tags: new Set(['a']),
        handlers: { onSave: () => 1 },
        slots: [createdAt, undefined],
        id: 1n,
      }),
    );

    expectTypeOf<PagePropsFor<typeof app, 'Settings'>>().toEqualTypeOf<{
      sessions: Array<{ createdAt: string; device?: string }>;
      price: number;
      tags: Record<string, never>;
      handlers: Record<never, never>;
      slots: Array<string | null>;
      id: bigint;
      errors: Errors;
    }>();
    const page = await firstVisitProperties(app, '/');
    expect(page.sessions).toEqual([
      { createdAt: '2026-01-02T03:04:05.000Z', device: 'phone' },
    ]);
    expect(page.price).toBe(12.5);
    expect(page.tags).toEqual({});
    expect(page.handlers).toEqual({});
    expect(page.slots).toEqual(['2026-01-02T03:04:05.000Z', null]);
  });

  it('types shared props as JSON sends them', async () => {
    const app = new Hono()
      .use(inertia({ render, share: () => ({ now: new Date() }) }))
      .get('/', (c) => c.var.inertia.render('Home'));

    expectTypeOf<SharedProps<typeof app>>().toEqualTypeOf<{
      now: string;
    }>();
    const page = await firstVisitProperties(app, '/');
    expect(typeof page.now).toBe('string');
  });

  it('keeps unknown props unknown', async () => {
    const app = new Hono()
      .use(inertia({ render }))
      .get('/', (c) =>
        c.var.inertia.render('Home', { data: JSON.parse('{}') as unknown }),
      );

    expectTypeOf<PagePropsFor<typeof app, 'Home'>>().toEqualTypeOf<{
      data: unknown;
      errors: Errors;
    }>();
    expect(await firstVisitProperties(app, '/')).toEqual({
      data: {},
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

// What vue-tsc gives a page component that declares these props
type VueComponent<Declared> = new () => { $props: Declared };

describe('MissingVuePagePropsFor', () => {
  const app = new Hono()
    .use(inertia({ render, share: () => ({ appName: 'Demo' }) }))
    .get('/users', (c) =>
      c.var.inertia.render('Users', {
        users: USERS,
        stats: optional(() => ({ total: 1 })),
      }),
    )
    .get('/contact', (c) => c.var.inertia.render('Contact'))
    .post('/contact', (c) =>
      c.var.inertia.render('Contact', { errors: { name: 'Required' } }),
    );

  it('names the route props a component leaves out', async () => {
    // The props it checks against
    expect(await firstVisitProperties(app, '/users')).toEqual({
      users: USERS,
      appName: 'Demo',
      errors: {},
    });
    expectTypeOf<
      MissingVuePagePropsFor<
        typeof app,
        'Users',
        VueComponent<{ users: unknown }>
      >
    >().toEqualTypeOf<'stats'>();
  });

  it('is never when the component declares every route prop', () => {
    expectTypeOf<
      MissingVuePagePropsFor<
        typeof app,
        'Users',
        VueComponent<{ users: unknown; stats?: unknown }>
      >
    >().toBeNever();
  });

  it('leaves out shared props and errors', () => {
    expectTypeOf<
      MissingVuePagePropsFor<typeof app, 'Contact', VueComponent<object>>
    >().toBeNever();
  });
});
