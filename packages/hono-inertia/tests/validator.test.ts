import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import { inertia } from '../src/middleware.js';
import { inertiaValidator } from '../src/validator.js';
import { serializePage } from '../src/serialize.js';
import type { InertiaEnv, InertiaSession, SessionData } from '../src/types.js';

const userSchema = z.object({
  name: z.string().min(1, 'Required'),
  email: z.email('Invalid email'),
});

function memorySession() {
  const state: { data: SessionData | null } = { data: null };
  const session: InertiaSession = {
    get: () => state.data,
    set: (_c, data) => {
      state.data = data;
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
  app.post('/users', inertiaValidator('json', userSchema), (c) => {
    const user = c.req.valid('json');
    return c.text(`created ${user.name}`);
  });
  return app;
}

const postUser = (
  app: Hono<InertiaEnv>,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  app.request('/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const DIGIT = /\d/;

const INVALID_USER = { name: '', email: 'nope' };
const VALID_USER = { name: 'Ada', email: 'ada@example.com' };

describe('Precognition', () => {
  it('answers 204 when the data is valid, without running the handler', async () => {
    const app = createApp();

    const response = await postUser(app, VALID_USER, { Precognition: 'true' });

    expect(response.status).toBe(204);
    expect(response.headers.get('Precognition')).toBe('true');
    expect(response.headers.get('Precognition-Success')).toBe('true');
    expect(await response.text()).toBe('');
  });

  it('answers 422 with every message per field', async () => {
    const app = createApp();

    const response = await postUser(app, INVALID_USER, {
      Precognition: 'true',
    });

    expect(response.status).toBe(422);
    expect(response.headers.get('Precognition')).toBe('true');
    expect(await response.json()).toEqual({
      message: 'The given data was invalid.',
      errors: { name: ['Required'], email: ['Invalid email'] },
    });
  });

  it('validates only the fields in Precognition-Validate-Only', async () => {
    const app = createApp();

    const response = await postUser(app, INVALID_USER, {
      Precognition: 'true',
      'Precognition-Validate-Only': 'email',
    });

    expect(await response.json()).toMatchObject({
      errors: { email: ['Invalid email'] },
    });
  });

  it('answers 204 when the listed fields pass and others fail', async () => {
    const app = createApp();

    const response = await postUser(
      app,
      { name: '', email: 'ada@example.com' },
      { Precognition: 'true', 'Precognition-Validate-Only': 'email' },
    );

    expect(response.status).toBe(204);
  });

  it('sends Vary: Precognition', async () => {
    const app = createApp();

    const response = await postUser(app, VALID_USER, { Precognition: 'true' });

    expect(response.headers.get('Vary')).toContain('Precognition');
  });

  it('keys nested fields by dotted path', async () => {
    const app = new Hono<InertiaEnv>();
    app.use(inertia({ render: () => '' }));
    app.post(
      '/orders',
      inertiaValidator(
        'json',
        z.object({
          items: z.array(z.object({ qty: z.number().min(1, 'Min 1') })),
        }),
      ),
      (c) => c.text('ok'),
    );

    const response = await app.request('/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Precognition: 'true' },
      body: JSON.stringify({ items: [{ qty: 1 }, { qty: 0 }] }),
    });

    expect(await response.json()).toMatchObject({
      errors: { 'items.1.qty': ['Min 1'] },
    });
  });

  it('keys an issue without a path as root', async () => {
    const app = new Hono<InertiaEnv>();
    app.use(inertia({ render: () => '' }));
    app.post(
      '/passwords',
      inertiaValidator(
        'json',
        z
          .object({ password: z.string(), confirmation: z.string() })
          .refine((data) => data.password === data.confirmation, 'No match'),
      ),
      (c) => c.text('ok'),
    );

    const response = await app.request('/passwords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Precognition: 'true' },
      body: JSON.stringify({ password: 'a', confirmation: 'b' }),
    });

    expect(await response.json()).toMatchObject({
      errors: { root: ['No match'] },
    });
  });
});

describe('Failed submits', () => {
  it('keeps errors for fields named like Object.prototype keys', async () => {
    const schema = z.object({
      constructor: z.string().min(1, 'Required'),
      toString: z.string().min(1, 'Required'),
    });
    const app = new Hono<InertiaEnv>()
      .use(inertia({ version: '1.0' }))
      .post('/form', inertiaValidator('json', schema), (c) => c.text('ok'));

    const response = await app.request('/form', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ constructor: '', toString: '' }),
    });

    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 422,
      body: {
        message: expect.any(String) as string,
        errors: { constructor: ['Required'], toString: ['Required'] },
      },
    });
  });

  it('redirects an Inertia request back', async () => {
    const { session } = memorySession();
    const app = createApp(session);

    const response = await postUser(app, INVALID_USER, {
      'X-Inertia': 'true',
      Referer: 'http://localhost/users/new',
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/users/new');
  });

  it('keeps the first message per field in the session', async () => {
    const { session, state } = memorySession();
    const app = new Hono<InertiaEnv>();
    app.use(inertia({ session, render: () => '' }));
    app.post(
      '/passwords',
      inertiaValidator(
        'json',
        z.object({
          password: z
            .string()
            .min(8, 'Too short')
            .regex(DIGIT, 'Needs a digit'),
        }),
      ),
      (c) => c.text('ok'),
    );

    await app.request('/passwords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Inertia': 'true' },
      body: JSON.stringify({ password: 'abc' }),
    });

    expect(state.data?.errors?.default).toEqual({ password: 'Too short' });
  });

  it('shows the errors on the page after the redirect', async () => {
    const { session } = memorySession();
    const app = createApp(session);
    app.get('/users/new', (c) => c.var.inertia.render('Users/New'));

    await postUser(app, INVALID_USER, { 'X-Inertia': 'true' });
    const response = await app.request('/users/new', {
      headers: { 'X-Inertia': 'true', 'X-Inertia-Version': '' },
    });

    const page = (await response.json()) as { props: { errors: unknown } };
    expect(page.props.errors).toEqual({
      name: 'Required',
      email: 'Invalid email',
    });
  });

  it('answers 422 JSON to a non-Inertia client that accepts JSON', async () => {
    const app = createApp(memorySession().session);

    const response = await postUser(app, INVALID_USER, {
      Accept: 'application/json',
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      errors: { email: ['Invalid email'] },
    });
  });

  it('fails without the session option', async () => {
    const app = createApp();

    const response = await postUser(app, INVALID_USER, { 'X-Inertia': 'true' });

    expect(response.status).toBe(500);
  });
});

describe('Valid submits', () => {
  it('reach the handler with the parsed data', async () => {
    const app = createApp();

    const response = await postUser(app, VALID_USER, { 'X-Inertia': 'true' });

    expect(await response.text()).toBe('created Ada');
  });

  it('send Vary: Precognition', async () => {
    const app = createApp();

    const response = await postUser(app, VALID_USER);

    expect(response.headers.get('Vary')).toContain('Precognition');
  });
});
