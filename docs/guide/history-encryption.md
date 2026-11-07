---
description: Encrypt and clear the browser history state
---

# History encryption

By default, Inertia stores page state unencrypted in browser history. Encrypt it on pages that render sensitive data, so the back button doesn't expose it after logout (see [Security](/guide/security)). Per request:

```ts
app.get('/dashboard', (c) => {
  c.var.inertia.encryptHistory();
  return c.var.inertia.render('Dashboard', { secret: 'data' });
});
```

Or globally for every response (a route can opt out with `encryptHistory(false)`):

```ts
inertia({ encryptHistory: true });
```

Clear encrypted history, for example on logout:

```ts
app.post('/logout', (c) => {
  c.var.inertia.clearHistory();
  return c.redirect('/login');
});
```

`clearHistory()` works on any response. The flag can only travel on a rendered page object, but logout handlers usually redirect or answer with 204. When a handler calls `clearHistory()` and returns anything other than a page (a redirect, a 409 from `clientRedirect()` or `location()`, a 204, or JSON), the middleware stores the flag in a short-lived first-party cookie (`inertia_clear_history`: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=60`). The next rendered page then carries `clearHistory: true`. Laravel does the same by keeping the flag in the session. There are two caveats. This middleware must render the next page, otherwise the cookie expires unused. And with `Path=/`, multiple apps on one origin share the flag.
