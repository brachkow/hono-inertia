---
description: Pass data to the root template, and head elements to the client
---

# View data and head elements

## View data

Pass data to the render function without exposing it to client-side JavaScript:

```ts
app.get('/users', (c) => {
  c.var.inertia.viewData({ metaTitle: 'User List' });
  return c.var.inertia.render('Users/Index', { users });
});
```

Access it in your render function:

```ts
render: (page, viewData) => `
  <html>
  <head><title>${escapeHtml(String(viewData.metaTitle))}</title></head>
  <body><script data-page="app" type="application/json">${serializePage(page)}</script><div id="app"></div></body>
  </html>
`;
```

The render function also receives the Hono context, so it can read request state such as a CSP nonce or a cookie:

```ts
render: (page, viewData, ssr, c) => `
  <html>
  <head><script nonce="${c.get('cspNonce')}">/* … */</script></head>
  <body><script data-page="app" type="application/json">${serializePage(page)}</script><div id="app"></div></body>
  </html>
`;
```

## Server-provided head elements

The client can take `<head>` elements from a prop (client 3.5+). Pass an array of raw HTML strings as `head`, and enable it on the client with `serverHead: true`:

```ts
app.get('/users/:id', async (c) => {
  const user = await db.users.find(c.req.param('id'));
  return c.var.inertia.render('Users/Show', {
    user,
    head: [
      `<title>${escapeHtml(user.name)}</title>`,
      `<meta name="description" content="${escapeHtml(user.bio)}">`,
      `<link data-inertia="canonical" rel="canonical" href="https://example.com/users/${user.id}">`,
    ],
  });
});
```

```ts
createInertiaApp({
  serverHead: true, // or a prop name, or (page) => string[]
});
```

`head` is an ordinary prop. The adapter sends it on every visit, the client re-syncs it on navigation, SSR renders it, and you can share it via `share`. The client inserts the strings as-is, so escape every interpolated value with `escapeHtml`. The client keys elements by array position. Set your own `data-inertia` key to give an element a stable identity (for a script that must not re-run on every visit), or to let a page-level `<Head>` override a server default with the same key.
