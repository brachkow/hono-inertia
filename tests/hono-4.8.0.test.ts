import { describe, expect, it } from 'vitest';
import { Hono } from 'hono-4.8.0';
import { inertia } from '../src/middleware.js';
import { serializePage } from '../src/serialize.js';
import type { InertiaEnvironment } from '../src/types.js';

// The oldest Hono the peer range allows: 4.8.0 is the first release with the
// hono/route helper the adapter imports.
const createApp = () => {
  const app = new Hono<InertiaEnvironment>();
  app.use(
    // @ts-expect-error The middleware is typed against the installed Hono; this test runs it on 4.8.0, whose Context types differ
    inertia({
      version: '1.0',
      render: (page) =>
        `<script data-page="app" type="application/json">${serializePage(page)}</script><div id="app"></div>`,
    }),
  );
  return app;
};

const inertiaHeaders = { 'X-Inertia': 'true', 'X-Inertia-Version': '1.0' };

describe('Hono 4.8.0', () => {
  it('marks Inertia responses with X-Inertia and a JSON content type', async () => {
    const app = createApp();
    app.get('/test', (c) => c.var.inertia.render('Test'));

    const response = await app.request('/test', { headers: inertiaHeaders });

    expect(response.headers.get('X-Inertia')).toBe('true');
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(await response.json()).toMatchObject({ component: 'Test' });
  });

  it('uses c.status() on Inertia responses', async () => {
    const app = createApp();
    app.get('/missing', (c) => {
      c.status(404);
      return c.var.inertia.render('Error');
    });

    const response = await app.request('/missing', { headers: inertiaHeaders });

    expect(response.status).toBe(404);
    expect(response.headers.get('X-Inertia')).toBe('true');
  });
});
