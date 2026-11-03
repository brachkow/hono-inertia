import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { inertia } from '../src/middleware.js';
import { cookieSession } from '../src/session.js';
import { serializePage } from '../src/serialize.js';
import type {
  InertiaEnv,
  InertiaSession,
  PageObject,
  SessionData,
} from '../src/types.js';

const SECRET = 'test-secret-that-is-at-least-32-bytes-long';

// A store that keeps the data in a variable, so tests can read what the
// middleware wrote without parsing cookies
function memorySession(initial: SessionData | null = null) {
  const state = { data: initial, writes: 0 };
  const session: InertiaSession = {
    get: () => state.data,
    set: (_c, data) => {
      state.data = data;
      state.writes += 1;
    },
  };
  return { session, state };
}

function createApp(session?: InertiaSession) {
  const app = new Hono<InertiaEnv>();
  app.use(
    inertia({
      version: '1.0',
      session,
      render: (page) =>
        `<script data-page="app" type="application/json">${serializePage(page)}</script>`,
    }),
  );
  return app;
}

const inertiaHeaders = (extra: Record<string, string> = {}) => ({
  'X-Inertia': 'true',
  'X-Inertia-Version': '1.0',
  ...extra,
});

const getPage = (response: Response) => response.json() as Promise<PageObject>;

// Carries Set-Cookie values into the next request's Cookie header
function cookieJar() {
  const cookies = new Map<string, string>();
  return {
    store(response: Response) {
      for (const header of response.headers.getSetCookie()) {
        const [pair] = header.split(';');
        const index = pair.indexOf('=');
        const name = pair.slice(0, index);
        const value = pair.slice(index + 1);
        if (value === '') cookies.delete(name);
        else cookies.set(name, value);
      }
    },
    header() {
      return Array.from(cookies, ([name, value]) => `${name}=${value}`).join(
        '; ',
      );
    },
  };
}

describe('withErrors', () => {
  it('keeps errors for the page after the redirect', async () => {
    const { session, state } = memorySession();
    const app = createApp(session);
    app.post('/users', (c) => {
      c.var.inertia.withErrors({ email: 'Taken' });
      return c.redirect('/users/new');
    });

    await app.request('/users', { method: 'POST', headers: inertiaHeaders() });

    expect(state.data).toEqual({ errors: { default: { email: 'Taken' } } });
  });

  it('shows session errors on the next page and clears them', async () => {
    const { session, state } = memorySession({
      errors: { default: { email: 'Taken' } },
    });
    const app = createApp(session);
    app.get('/users/new', (c) => c.var.inertia.render('Users/New'));

    const response = await app.request('/users/new', {
      headers: inertiaHeaders(),
    });

    const page = await getPage(response);

    expect(page.props.errors).toEqual({ email: 'Taken' });
    expect(state.data).toBeNull();
  });

  it('sends the first message when a field has several', async () => {
    const { session } = memorySession({
      errors: { default: { password: ['Too short', 'Needs a digit'] } },
    });
    const app = createApp(session);
    app.get('/', (c) => c.var.inertia.render('Home'));

    const response = await app.request('/', { headers: inertiaHeaders() });

    const page = await getPage(response);

    expect(page.props.errors).toEqual({
      password: 'Too short',
    });
  });

  it('shows errors on a page rendered in the same request', async () => {
    const { session, state } = memorySession();
    const app = createApp(session);
    app.post('/users', (c) => {
      c.var.inertia.withErrors({ email: 'Taken' });
      return c.var.inertia.render('Users/New');
    });

    const response = await app.request('/users', {
      method: 'POST',
      headers: inertiaHeaders(),
    });

    const page = await getPage(response);

    expect(page.props.errors).toEqual({ email: 'Taken' });
    expect(state.writes).toBe(0);
  });

  it('merges calls into one bag', async () => {
    const { session, state } = memorySession();
    const app = createApp(session);
    app.post('/users', (c) => {
      c.var.inertia.withErrors({ email: 'Taken' });
      c.var.inertia.withErrors({ name: 'Required' });
      return c.redirect('/users/new');
    });

    await app.request('/users', { method: 'POST', headers: inertiaHeaders() });

    expect(state.data?.errors?.default).toEqual({
      email: 'Taken',
      name: 'Required',
    });
  });

  it('shows errors on a page rendered in the same request without a session', async () => {
    const app = createApp();
    app.post('/users', (c) => {
      c.var.inertia.withErrors({ email: 'Taken' });
      return c.var.inertia.render('Users/New');
    });

    const response = await app.request('/users', {
      method: 'POST',
      headers: inertiaHeaders(),
    });

    const page = await getPage(response);
    expect(page.props.errors).toEqual({ email: 'Taken' });
  });

  it('keeps only the first message per field in the session', async () => {
    const { session, state } = memorySession();
    const app = createApp(session);
    app.post('/users', (c) => {
      c.var.inertia.withErrors({ password: ['Too short', 'Needs a digit'] });
      return c.redirect('/users/new');
    });

    await app.request('/users', { method: 'POST', headers: inertiaHeaders() });

    expect(state.data?.errors?.default).toEqual({ password: 'Too short' });
  });

  it('fails a redirect after withErrors without the session option', async () => {
    const app = createApp();
    app.post('/users', (c) => {
      c.var.inertia.withErrors({ email: 'Taken' });
      return c.redirect('/users/new');
    });

    const response = await app.request('/users', {
      method: 'POST',
      headers: inertiaHeaders(),
    });

    expect(response.status).toBe(500);
  });

  it('lets a page errors prop win over session errors', async () => {
    const { session } = memorySession({
      errors: { default: { email: 'Taken' } },
    });
    const app = createApp(session);
    app.get('/', (c) =>
      c.var.inertia.render('Home', { errors: { name: 'Required' } }),
    );

    const response = await app.request('/', { headers: inertiaHeaders() });

    const page = await getPage(response);

    expect(page.props.errors).toEqual({
      name: 'Required',
    });
  });
});

describe('Error bags from the session', () => {
  it('puts the default bag under the requested bag name', async () => {
    const { session } = memorySession({
      errors: { default: { email: 'Taken' } },
    });
    const app = createApp(session);
    app.get('/', (c) => c.var.inertia.render('Home'));

    const response = await app.request('/', {
      headers: inertiaHeaders({ 'X-Inertia-Error-Bag': 'createUser' }),
    });

    const page = await getPage(response);

    expect(page.props.errors).toEqual({
      createUser: { email: 'Taken' },
    });
  });

  it('shows named bags under their names when there is no default bag', async () => {
    const { session } = memorySession({
      errors: { login: { email: 'Unknown' }, signup: { name: 'Required' } },
    });
    const app = createApp(session);
    app.get('/', (c) => c.var.inertia.render('Home'));

    const response = await app.request('/', { headers: inertiaHeaders() });

    const page = await getPage(response);

    expect(page.props.errors).toEqual({
      login: { email: 'Unknown' },
      signup: { name: 'Required' },
    });
  });

  it('sends empty errors as an object', async () => {
    const { session } = memorySession();
    const app = createApp(session);
    app.get('/', (c) => c.var.inertia.render('Home'));

    const response = await app.request('/', { headers: inertiaHeaders() });

    const page = await getPage(response);

    expect(page.props.errors).toEqual({});
  });

  it('keeps session errors in a partial reload that leaves errors out', async () => {
    const { session } = memorySession({
      errors: { default: { email: 'Taken' } },
    });
    const app = createApp(session);
    app.get('/', (c) => c.var.inertia.render('Home', { users: [] }));

    const response = await app.request('/', {
      headers: inertiaHeaders({
        'X-Inertia-Partial-Component': 'Home',
        'X-Inertia-Partial-Data': 'users',
      }),
    });

    const page = await getPage(response);

    expect(page.props.errors).toEqual({ email: 'Taken' });
  });
});

describe('Flash across redirects', () => {
  it('keeps flash data for the page after the redirect', async () => {
    const { session, state } = memorySession();
    const app = createApp(session);
    app.post('/users', (c) => {
      c.var.inertia.flash({ success: 'Created' });
      return c.redirect('/users');
    });

    await app.request('/users', { method: 'POST', headers: inertiaHeaders() });

    expect(state.data).toEqual({ flash: { success: 'Created' } });
  });

  it('puts session flash data on the next page', async () => {
    const { session, state } = memorySession({ flash: { success: 'Created' } });
    const app = createApp(session);
    app.get('/users', (c) => c.var.inertia.render('Users/Index'));

    const response = await app.request('/users', { headers: inertiaHeaders() });

    const page = await getPage(response);

    expect(page.flash).toEqual({ success: 'Created' });
    expect(state.data).toBeNull();
  });

  it('reflashes through a chain of redirects', async () => {
    const { session, state } = memorySession({ flash: { success: 'Created' } });
    const app = createApp(session);
    app.get('/old', (c) => c.redirect('/new'));

    await app.request('/old', { headers: inertiaHeaders() });

    expect(state.data).toEqual({ flash: { success: 'Created' } });
  });

  it('adds new flash data to what a redirect carries on', async () => {
    const { session, state } = memorySession({ flash: { success: 'Created' } });
    const app = createApp(session);
    app.get('/old', (c) => {
      c.var.inertia.flash({ info: 'Moved' });
      return c.redirect('/new');
    });

    await app.request('/old', { headers: inertiaHeaders() });

    expect(state.data).toEqual({
      flash: { success: 'Created', info: 'Moved' },
    });
  });

  it('keeps the session on an asset version mismatch', async () => {
    const { session, state } = memorySession({ flash: { success: 'Created' } });
    const app = createApp(session);
    app.get('/users', (c) => c.var.inertia.render('Users/Index'));

    const response = await app.request('/users', {
      headers: inertiaHeaders({ 'X-Inertia-Version': 'old' }),
    });

    expect(response.status).toBe(409);
    expect(state.data).toEqual({ flash: { success: 'Created' } });
    expect(state.writes).toBe(0);
  });

  it('leaves the session alone for a prefetch', async () => {
    const { session, state } = memorySession({ flash: { success: 'Created' } });
    const app = createApp(session);
    app.get('/users', (c) => c.var.inertia.render('Users/Index'));

    const response = await app.request('/users', {
      headers: inertiaHeaders({ Purpose: 'prefetch' }),
    });

    const page = await getPage(response);

    expect(page.flash).toBeUndefined();
    expect(state.writes).toBe(0);
  });

  it('leaves the session alone for a response that is not a page', async () => {
    const { session, state } = memorySession({ flash: { success: 'Created' } });
    const app = createApp(session);
    app.get('/api/count', (c) => c.json({ count: 1 }));

    await app.request('/api/count');

    expect(state.writes).toBe(0);
  });
});

describe('cookieSession', () => {
  it('carries errors and flash data to the next request', async () => {
    const app = createApp(cookieSession({ secret: SECRET }));
    app.post('/users', (c) => {
      c.var.inertia.withErrors({ email: 'Taken' });
      c.var.inertia.flash({ info: 'Check the form' });
      return c.redirect('/users/new');
    });
    app.get('/users/new', (c) => c.var.inertia.render('Users/New'));
    const jar = cookieJar();

    jar.store(
      await app.request('/users', {
        method: 'POST',
        headers: inertiaHeaders(),
      }),
    );
    const response = await app.request('/users/new', {
      headers: inertiaHeaders({ Cookie: jar.header() }),
    });

    const page = await getPage(response);
    expect(page.props.errors).toEqual({ email: 'Taken' });
    expect(page.flash).toEqual({ info: 'Check the form' });
  });

  it('deletes the cookie once a page used it', async () => {
    const app = createApp(cookieSession({ secret: SECRET }));
    app.post('/users', (c) => {
      c.var.inertia.flash({ success: 'Created' });
      return c.redirect('/users');
    });
    app.get('/users', (c) => c.var.inertia.render('Users/Index'));
    const jar = cookieJar();

    jar.store(
      await app.request('/users', {
        method: 'POST',
        headers: inertiaHeaders(),
      }),
    );
    jar.store(
      await app.request('/users', {
        headers: inertiaHeaders({ Cookie: jar.header() }),
      }),
    );
    const response = await app.request('/users', {
      headers: inertiaHeaders({ Cookie: jar.header() }),
    });

    const page = await getPage(response);

    expect(page.flash).toBeUndefined();
  });

  it('sets an HttpOnly, SameSite=Lax cookie with a short lifetime', async () => {
    const app = createApp(cookieSession({ secret: SECRET }));
    app.post('/users', (c) => {
      c.var.inertia.flash({ success: 'Created' });
      return c.redirect('/users');
    });

    const response = await app.request('/users', {
      method: 'POST',
      headers: inertiaHeaders(),
    });

    const cookie = response.headers.get('Set-Cookie') ?? '';
    expect(cookie).toContain('inertia_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=300');
  });

  it('ignores a cookie with a bad signature', async () => {
    const app = createApp(cookieSession({ secret: SECRET }));
    app.get('/', (c) => c.var.inertia.render('Home'));
    const forged = encodeURIComponent(
      `${JSON.stringify({ flash: { success: 'Forged' } })}.bad-signature`,
    );

    const response = await app.request('/', {
      headers: inertiaHeaders({ Cookie: `inertia_session=${forged}` }),
    });

    const page = await getPage(response);

    expect(page.flash).toBeUndefined();
  });

  it('ignores a cookie signed with another secret', async () => {
    const writer = createApp(cookieSession({ secret: SECRET }));
    writer.post('/users', (c) => {
      c.var.inertia.flash({ success: 'Created' });
      return c.redirect('/users');
    });
    const reader = createApp(
      cookieSession({ secret: 'another-secret-that-is-at-least-32-bytes' }),
    );
    reader.get('/users', (c) => c.var.inertia.render('Users/Index'));
    const jar = cookieJar();

    jar.store(
      await writer.request('/users', {
        method: 'POST',
        headers: inertiaHeaders(),
      }),
    );
    const response = await reader.request('/users', {
      headers: inertiaHeaders({ Cookie: jar.header() }),
    });

    const page = await getPage(response);

    expect(page.flash).toBeUndefined();
  });

  it('reads cookies signed with an older secret from the list', async () => {
    const OLD_SECRET = 'old-secret-that-is-at-least-32-bytes-long';
    const writer = createApp(cookieSession({ secret: OLD_SECRET }));
    writer.post('/users', (c) => {
      c.var.inertia.flash({ success: 'Created' });
      return c.redirect('/users');
    });
    const reader = createApp(cookieSession({ secret: [SECRET, OLD_SECRET] }));
    reader.get('/users', (c) => c.var.inertia.render('Users/Index'));
    const jar = cookieJar();

    jar.store(
      await writer.request('/users', {
        method: 'POST',
        headers: inertiaHeaders(),
      }),
    );
    const response = await reader.request('/users', {
      headers: inertiaHeaders({ Cookie: jar.header() }),
    });

    const page = await getPage(response);
    expect(page.flash).toEqual({ success: 'Created' });
  });

  it('signs with the first secret in the list', async () => {
    const OLD_SECRET = 'old-secret-that-is-at-least-32-bytes-long';
    const writer = createApp(cookieSession({ secret: [SECRET, OLD_SECRET] }));
    writer.post('/users', (c) => {
      c.var.inertia.flash({ success: 'Created' });
      return c.redirect('/users');
    });
    const reader = createApp(cookieSession({ secret: SECRET }));
    reader.get('/users', (c) => c.var.inertia.render('Users/Index'));
    const jar = cookieJar();

    jar.store(
      await writer.request('/users', {
        method: 'POST',
        headers: inertiaHeaders(),
      }),
    );
    const response = await reader.request('/users', {
      headers: inertiaHeaders({ Cookie: jar.header() }),
    });

    const page = await getPage(response);
    expect(page.flash).toEqual({ success: 'Created' });
  });

  it('reads the secret per request from a function', async () => {
    const app = new Hono<InertiaEnv & { Bindings: { SECRET: string } }>();
    app.use(
      inertia({
        session: cookieSession({
          secret: (c) => (c.env as { SECRET: string }).SECRET,
        }),
        render: () => '',
      }),
    );
    app.post('/users', (c) => {
      c.var.inertia.flash({ success: 'Created' });
      return c.redirect('/users');
    });

    const response = await app.request(
      '/users',
      { method: 'POST', headers: inertiaHeaders() },
      { SECRET },
    );

    expect(response.headers.get('Set-Cookie')).toContain('inertia_session=');
  });

  it('fails the request when the data does not fit in a cookie', async () => {
    const app = createApp(cookieSession({ secret: SECRET }));
    app.post('/users', (c) => {
      c.var.inertia.flash({ big: 'x'.repeat(5000) });
      return c.redirect('/users');
    });

    const response = await app.request('/users', {
      method: 'POST',
      headers: inertiaHeaders(),
    });

    expect(response.status).toBe(500);
  });
});
