import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { inertia } from '../src/middleware.js';
import { serializePage } from '../src/serialize.js';
import type { InertiaEnv } from '../src/types.js';

function createApp() {
  const app = new Hono<InertiaEnv>();
  app.use(
    inertia({
      version: '1.0',
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

describe('303 after QUERY', () => {
  it('converts a 302 after a QUERY request', async () => {
    const app = createApp();
    app.on('QUERY', '/search', (c) => c.redirect('/results'));

    const response = await app.request('/search', {
      method: 'QUERY',
      headers: inertiaHeaders(),
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/results');
  });
});

describe('Empty 200 responses', () => {
  it('redirects back to the Referer', async () => {
    const app = createApp();
    app.post('/users', (c) => c.body(null));

    const response = await app.request('/users', {
      method: 'POST',
      headers: inertiaHeaders({ Referer: 'http://localhost/users/new?step=2' }),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/users/new?step=2');
  });

  it('becomes a 303 after a PUT', async () => {
    const app = createApp();
    app.put('/users/1', (c) => c.body(null));

    const response = await app.request('/users/1', {
      method: 'PUT',
      headers: inertiaHeaders({ Referer: 'http://localhost/users/1/edit' }),
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/users/1/edit');
  });

  it('redirects to / without a Referer', async () => {
    const app = createApp();
    app.post('/users', (c) => c.body(null));

    const response = await app.request('/users', {
      method: 'POST',
      headers: inertiaHeaders(),
    });

    expect(response.headers.get('Location')).toBe('/');
  });

  it('keeps only the path of a Referer from another origin', async () => {
    const app = createApp();
    app.post('/users', (c) => c.body(null));

    const response = await app.request('/users', {
      method: 'POST',
      headers: inertiaHeaders({ Referer: 'https://evil.example/phish' }),
    });

    expect(response.headers.get('Location')).toBe('/phish');
  });

  it('keeps headers the handler set', async () => {
    const app = createApp();
    app.post('/users', (c) => c.body(null, 200, { 'X-Request-Id': 'abc' }));

    const response = await app.request('/users', {
      method: 'POST',
      headers: inertiaHeaders(),
    });

    expect(response.headers.get('X-Request-Id')).toBe('abc');
  });

  it('leaves an empty 200 alone for a non-Inertia request', async () => {
    const app = createApp();
    app.post('/webhook', (c) => c.body(null));

    const response = await app.request('/webhook', { method: 'POST' });

    expect(response.status).toBe(200);
  });

  it('leaves a 200 with a body alone', async () => {
    const app = createApp();
    app.post('/users', (c) => c.text('ok'));

    const response = await app.request('/users', {
      method: 'POST',
      headers: inertiaHeaders(),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
  });
});

describe('back()', () => {
  it('redirects to the Referer path', async () => {
    const app = createApp();
    app.post('/users', (c) => c.var.inertia.back());

    const response = await app.request('/users', {
      method: 'POST',
      headers: { Referer: 'http://localhost/users/new' },
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/users/new');
  });

  it('uses the fallback without a Referer', async () => {
    const app = createApp();
    app.post('/users', (c) => c.var.inertia.back('/users'));

    const response = await app.request('/users', { method: 'POST' });

    expect(response.headers.get('Location')).toBe('/users');
  });
});

describe('Fragment redirects', () => {
  it('turns a redirect to a URL with a fragment into a 409', async () => {
    const app = createApp();
    app.post('/comments', (c) => c.redirect('/posts/1#comment-5'));

    const response = await app.request('/comments', {
      method: 'POST',
      headers: inertiaHeaders(),
    });

    expect(response.status).toBe(409);
    expect(response.headers.get('X-Inertia-Redirect')).toBe(
      '/posts/1#comment-5',
    );
    expect(response.headers.get('Location')).toBeNull();
  });

  it('leaves the redirect alone for a prefetch', async () => {
    const app = createApp();
    app.get('/latest', (c) => c.redirect('/posts/1#comment-5'));

    const response = await app.request('/latest', {
      headers: inertiaHeaders({ Purpose: 'prefetch' }),
    });

    expect(response.status).toBe(302);
  });

  it('leaves the redirect alone for a non-Inertia request', async () => {
    const app = createApp();
    app.get('/latest', (c) => c.redirect('/posts/1#comment-5'));

    const response = await app.request('/latest');

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/posts/1#comment-5');
  });
});
