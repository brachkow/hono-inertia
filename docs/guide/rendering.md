---
description: Render pages with lazy and nested props, and set the page URL
---

# Rendering pages

```ts
app.get('/users', async (c) => {
  return c.var.inertia.render('Users/Index', {
    users: await db.users.findMany(),
  });
});
```

Props can be lazy functions. The adapter calls them only when the response includes the prop:

```ts
app.get('/dashboard', (c) => {
  return c.var.inertia.render('Dashboard', {
    stats: async () => computeExpensiveStats(),
    users: () => db.users.findMany(),
  });
});
```

## Nested props

Props inside plain objects work as at the top level, as in inertia-laravel. The adapter calls lazy functions inside them, prop types like `optional()` and `deferred()` work inside them, and a partial reload can name a nested path:

```ts
c.var.inertia.render('Settings', {
  auth: {
    user: () => getUser(c),
    permissions: optional(() => getPermissions(c)),
  },
});
```

The first visit sends `auth.user` and leaves out `auth.permissions`. `router.reload({ only: ['auth.permissions'] })` sends `{ auth: { permissions } }`, and the client merges it into the `auth` it holds. Metadata names nested props by their path, such as `auth.permissions` in `deferredProps`. Arrays, class instances, `Map`, `Set` and objects with `toJSON()` are values, which the adapter sends as they are.

## Page URL

The client shows `page.url` in the address bar. It defaults to the request's path and query, as in inertia-laravel. A handler that renders on a `POST`, for example to show validation errors without redirecting, therefore puts the `POST` URL in the address bar. Set the URL for one response with `c.var.inertia.url()`:

```ts
app.post('/users', async (c) => {
  const errors = await validate(c);
  if (errors) {
    c.var.inertia.url('/users/new');
    return c.var.inertia.render('Users/New', { errors });
  }
  // ...
});
```

To change the default for every response, pass `resolveUrl`. This one uses the page the request came from for non-`GET` requests, like `@hono/inertia` does:

```ts
inertia({
  resolveUrl: (c) =>
    c.req.method === 'GET' ? c.req.url : (c.req.header('Referer') ?? c.req.url),
  // ...
});
```

The `Referer` is missing under a `no-referrer` policy and holds only the origin under `origin` or `strict-origin`, so the fallback matters. Both `url()` and `resolveUrl` accept an absolute or relative URL. The adapter resolves it against the request URL and drops the origin, so an internal origin behind a proxy never reaches the client.

## BigInt props

Props and flash data can hold `BigInt` values, such as 64-bit IDs from a `bigint` column. JSON has no BigInt, so the adapter sends each one as a `{ "$bigint": "<digits>" }` marker and sets `preserveBigIntegers: true` on the page. The Inertia client (3.8+) turns the markers back into `BigInt` values on initial visits, Inertia requests, SSR and history restores. Pages without a `BigInt` are sent unchanged:

```ts
app.get('/orders/:id', async (c) => {
  return c.var.inertia.render('Orders/Show', {
    id: 900719925474099988n, // arrives in the component as a BigInt
  });
});
```

Older clients receive the markers as plain objects. A `BigInt` that the client sends back through the router or a form arrives as a numeric string.
