---
description: Status codes, external and fragment redirects, and redirecting back
---

# Redirects

## Status codes

`render()` responds with 200 by default. Set another status with `c.status()` before rendering. It applies to both initial visits and Inertia requests, and the client renders the page for any status:

```ts
app.notFound((c) => {
  c.status(404);
  return c.var.inertia.render('Error', { status: 404 });
});
```

## External redirects

Redirect to a non-Inertia URL. Inertia requests get a 409, regular requests get a 302:

```ts
app.get('/download', (c) => {
  return c.var.inertia.location('https://example.com/file.pdf');
});
```

Validate any user-supplied URL before passing it to `location()` or `clientRedirect()` to avoid open redirects (see [Security](/guide/security)).

## Fragment redirects

The client cannot read the fragment of a redirect that its HTTP client followed. So on an Inertia request, the middleware turns a redirect to a URL with `#` into a 409 with `X-Inertia-Redirect`, and the client visits the full URL itself. Prefetch requests get the redirect unchanged:

```ts
app.post('/posts/:id/comments', async (c) => {
  const comment = await createComment(c);
  return c.redirect(`/posts/${c.req.param('id')}#comment-${comment.id}`);
});
```

`c.var.inertia.clientRedirect(url)` sends the same 409 for any URL. To keep the fragment of the URL the user came from after an ordinary redirect, call `c.var.inertia.preserveFragment()`. Like [`clearHistory()`](/guide/history-encryption), it works before a redirect: the middleware keeps the flag in a short-lived cookie (`inertia_preserve_fragment`) until the next rendered page.

## Redirecting back

`c.var.inertia.back()` redirects to the path of the `Referer` header, or to `/` without one. Pass another fallback as the argument. It keeps only the path, query and fragment of the `Referer`, so it never leaves your origin:

```ts
app.post('/settings', async (c) => {
  await saveSettings(c);
  return c.var.inertia.back('/settings');
});
```

An options object also takes `status` (default 302) and `removeQuery`, which drops the named query parameters from the `Referer`, or all of them with `true`. Use it, for example, to close a modal that lives in the query:

```ts
return c.var.inertia.back({ status: 303, removeQuery: ['modal'] });
```

An Inertia request whose handler returns an empty 200, such as `c.body(null)`, is redirected back the same way. After PUT, PATCH, DELETE and QUERY requests, the middleware turns the 302 into a 303, so the browser follows it with GET.
