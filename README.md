# @brachkow/hono-inertia

Inertia.js v3 server-side adapter for [Hono](https://hono.dev).

## Install

```bash
pnpm add @brachkow/hono-inertia
```

## Quick start

```ts
import { Hono } from 'hono'
import { inertia, serializePage } from '@brachkow/hono-inertia'
import type { InertiaEnv } from '@brachkow/hono-inertia'

const app = new Hono<InertiaEnv>()

app.use(
  inertia({
    version: '1.0',
    render: (page) =>
      `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <script type="module" src="/src/main.ts"></script>
</head>
<body>
  <div id="app" data-page="${serializePage(page)}"></div>
</body>
</html>`,
  }),
)

app.get('/', (c) => {
  return c.var.inertia.render('Home', { title: 'Hello' })
})

export default app
```

## Configuration

```ts
inertia({
  // Asset version — string or function (sync/async)
  version: '1.0',
  version: () => readFileSync('dist/manifest.json', 'utf-8'),

  // HTML render function — receives page object, view data, and optional SSR result.
  // Use serializePage(page) — never a bare JSON.stringify — see Security below.
  render: (page, viewData, ssr) => {
    if (ssr) {
      return `<html><head>${ssr.head}</head><body>${ssr.body}</body></html>`
    }
    return `<html><body><div id="app" data-page="${serializePage(page)}"></div></body></html>`
  },

  // Global shared props — merged into every response
  share: (c) => ({
    auth: { user: getUser(c) },
  }),

  // SSR — optional, posts to an Inertia SSR server
  ssr: {
    url: 'http://127.0.0.1:13714',
    enabled: true,
  },
})
```

## Rendering pages

```ts
app.get('/users', (c) => {
  return c.var.inertia.render('Users/Index', {
    users: await db.users.findMany(),
  })
})
```

Props can be lazy functions — they're only called when the prop is actually included in the response:

```ts
app.get('/dashboard', (c) => {
  return c.var.inertia.render('Dashboard', {
    stats: async () => computeExpensiveStats(),
    users: () => db.users.findMany(),
  })
})
```

## Shared data

Global shared props via config:

```ts
inertia({
  share: (c) => ({
    auth: { user: getUser(c) },
    flash: getFlash(c),
  }),
})
```

Per-request shared props via middleware:

```ts
app.use(async (c, next) => {
  c.var.inertia.share({ notifications: getNotifications(c) })
  await next()
})
```

Render props override shared props. Shared props override config-level props.

## Prop types

### `always(value)`

Always included in every response, including partial reloads:

```ts
import { always } from '@brachkow/hono-inertia'

c.var.inertia.render('Dashboard', {
  auth: always({ user: currentUser }),
})
```

### `optional(fn)`

Excluded from initial visits. Only included when explicitly requested in a partial reload:

```ts
import { optional } from '@brachkow/hono-inertia'

c.var.inertia.render('Users/Index', {
  permissions: optional(() => fetchPermissions()),
})
```

### `deferred(fn, group?)`

Excluded from the initial response. The client automatically fetches them after mount:

```ts
import { deferred } from '@brachkow/hono-inertia'

c.var.inertia.render('Dashboard', {
  stats: deferred(() => computeStats()),
  comments: deferred(() => fetchComments(), 'sidebar'),
  likes: deferred(() => fetchLikes(), 'sidebar'),
})
```

### `merge(value)` / `prepend(value)` / `deepMerge(value)`

Client appends/prepends/deep-merges new data instead of replacing. Useful for infinite scroll:

```ts
import { merge, prepend, deepMerge } from '@brachkow/hono-inertia'

c.var.inertia.render('Feed', {
  posts: merge(() => fetchPosts(page)),
  newPosts: prepend(() => fetchNewPosts()),
  settings: deepMerge(() => fetchSettings()),
})
```

Use `.setMatchOn(field)` for array matching:

```ts
c.var.inertia.render('Feed', {
  posts: merge(() => fetchPosts()).setMatchOn('id'),
})
```

### `once(fn, key?, expiresAt?)`

Resolved once, then cached by the client across navigations:

```ts
import { once } from '@brachkow/hono-inertia'

c.var.inertia.render('Pricing', {
  plans: once(() => fetchPlans()),
  config: once(() => fetchConfig(), 'app-config', 86400),
})
```

### Chaining

Prop types can be combined:

```ts
// Deferred + merge + once
deferred(() => fetchFeed(), 'main').merge().once()

// Deferred + prepend
deferred(() => fetchNew(), 'top').prepend()

// Optional + once
optional(() => fetchExpensiveData()).once('cache-key', 3600)

// Deep merge with match key
deepMerge(() => fetchItems()).setMatchOn('id')
```

## External redirects

Redirect to a non-Inertia URL (returns 409 for Inertia requests, 302 for regular):

```ts
app.get('/download', (c) => {
  return c.var.inertia.location('https://example.com/file.pdf')
})
```

Validate any user-supplied URL before passing it to `location()` or `redirect()` to avoid open redirects (see [Security](#security)).

## History encryption

Page state is stored **unencrypted** in browser history by default. Encrypt it on pages that render sensitive data so it isn't exposed via the back button after logout (see [Security](#security)). Per request:

```ts
app.get('/dashboard', (c) => {
  c.var.inertia.encryptHistory()
  return c.var.inertia.render('Dashboard', { secret: 'data' })
})
```

Or globally for every response (a route can opt out with `encryptHistory(false)`):

```ts
inertia({ encryptHistory: true })
```

Clear encrypted history (e.g., on logout):

```ts
app.post('/logout', (c) => {
  c.var.inertia.clearHistory()
  return c.redirect('/login')
})
```

## View data

Pass data to the render function without exposing it to the client-side JavaScript:

```ts
app.get('/users', (c) => {
  c.var.inertia.viewData({ metaTitle: 'User List' })
  return c.var.inertia.render('Users/Index', { users })
})
```

Access it in your render function:

```ts
render: (page, viewData) => `
  <html>
  <head><title>${escapeHtml(String(viewData.metaTitle))}</title></head>
  <body><div id="app" data-page="${serializePage(page)}"></div></body>
  </html>
`
```

## Flash messages

Send one-shot messages (toasts, alerts) to the client. They're delivered to the `onFlash` callback and the `inertia:flash` event on the next render — including the initial visit — then cleared from history so they don't replay on back/forward:

```ts
app.post('/users', async (c) => {
  await createUser(c)
  c.var.inertia.flash({ success: 'User created' })
  return c.var.inertia.render('Users/Index', { users })
})
```

`flash()` accumulates across calls (later keys win), and flash data is a top-level field — it is never mixed into your props.

Because this adapter is session-less, `flash()` applies to the **current** response only. To show a message *after* a redirect (the POST → redirect → GET pattern), persist it across the redirect yourself (e.g. a short-lived cookie) and re-apply it — for example in middleware:

```ts
app.use(async (c, next) => {
  const flash = readFlashCookie(c) // your own helper
  if (flash) c.var.inertia.flash(flash)
  await next()
})
```

## SSR

Configure an Inertia SSR server (works with `@inertiajs/vue3/server`, `@inertiajs/react/server`, `@inertiajs/svelte/server`):

```ts
inertia({
  ssr: {
    url: 'http://127.0.0.1:13714', // default
    enabled: true,
    timeout: 5000, // ms before falling back to client-side rendering (default 5000)
  },
  render: (page, viewData, ssr) => {
    if (ssr) {
      // ssr.head / ssr.body are HTML rendered by your own (trusted) SSR server
      return `<html><head>${ssr.head}</head><body>${ssr.body}</body></html>`
    }
    return `<html><body><div id="app" data-page="${serializePage(page)}"></div></body></html>`
  },
})
```

Falls back to client-side rendering if the SSR server is unavailable.

## Security

This adapter follows Inertia's official conventions, but a few responsibilities sit with you. In short: **embed the page object with `serializePage`, escape user-controlled view data with `escapeHtml`, and add CSRF protection.**

### Embedding the page object (XSS)

Always embed the page object with `serializePage(page)`, never a bare `JSON.stringify(page)`. `JSON.stringify` does not escape `<`, so a prop value containing `</script>` (a username, comment, search term, validation message, …) would break out of the surrounding markup and execute as HTML/JavaScript. `serializePage` HTML-escapes the JSON for the `data-page` attribute that the Inertia client reads:

```ts
import { serializePage } from '@brachkow/hono-inertia'

render: (page) => `<div id="app" data-page="${serializePage(page)}"></div>`
```

For any other user-influenced value you interpolate into HTML yourself (e.g. view data in a `<title>`), use `escapeHtml`:

```ts
import { escapeHtml } from '@brachkow/hono-inertia'

render: (page, viewData) =>
  `<title>${escapeHtml(String(viewData.title))}</title>
   <div id="app" data-page="${serializePage(page)}"></div>`
```

### CSRF

This adapter does not provide CSRF protection, and the `X-Inertia` header is not a substitute for it. Add CSRF middleware for state-changing requests — with Hono:

```ts
import { csrf } from 'hono/csrf'

app.use(csrf())
```

The Inertia client (axios) automatically echoes the `XSRF-TOKEN` cookie back in an `X-XSRF-TOKEN` header, so a cookie-token + header-verification scheme works out of the box.

### History encryption

Page state is stored unencrypted in browser history by default, so a user who presses Back after logging out can still read the previous page's props. Encrypt history on pages with sensitive data — per request with `c.var.inertia.encryptHistory()` or globally with `inertia({ encryptHistory: true })`. It uses the Web Crypto API and therefore requires HTTPS.

### Redirects

`location()` and `redirect()` send the URL you pass straight to the browser. Never pass unvalidated user input (e.g. a `?next=` parameter) to them — validate against an allowlist or restrict to same-origin paths first — or you create an open redirect.

### SSR

The SSR server is a trust boundary: its `head`/`body` are interpolated into your HTML as-is (they are rendered HTML and cannot be escaped without breaking the page). Only point `ssr.url` at a server you control — loopback or an authenticated internal host over HTTPS — and never source it from untrusted input. Responses are bounded by `ssr.timeout` and `ssr.maxResponseBytes`.

## TypeScript

Use `InertiaEnv` for typed `c.var.inertia` access:

```ts
import type { InertiaEnv } from '@brachkow/hono-inertia'

const app = new Hono<InertiaEnv>()
```

Compose with your own env types:

```ts
type AppEnv = InertiaEnv & {
  Variables: { db: Database }
}

const app = new Hono<AppEnv>()
```

## License

MIT
