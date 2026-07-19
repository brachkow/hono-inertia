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
  // Asset version — string or function (sync/async). Derive it from your Vite
  // manifest with manifestVersion (see Asset versioning below). Omit to
  // disable version checks.
  version: manifestVersion(manifest),

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

  // Cache-Control for adapter-emitted responses (see Security → Caching).
  // Defaults to 'private, no-cache, must-revalidate'; set false to omit.
  cacheControl: 'private, no-cache, must-revalidate',
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

### `scroll(value, metadata)`

Backs the client's `<InfiniteScroll>` component. `value` is the array of rows for the
current page; pagination state is supplied separately via a `ScrollMetadata` adapter:

```ts
import { scroll } from '@brachkow/hono-inertia'
import type { ScrollMetadata } from '@brachkow/hono-inertia'

app.get('/feed', async (c) => {
  const page = Number(c.req.query('page') ?? 1)
  const { rows, lastPage } = await fetchPosts(page)

  const metadata: ScrollMetadata = {
    getPageName: () => 'page',
    getCurrentPage: () => page,
    getPreviousPage: () => (page > 1 ? page - 1 : null),
    getNextPage: () => (page < lastPage ? page + 1 : null),
  }

  return c.var.inertia.render('Feed', { posts: scroll(rows, metadata) })
})
```

`<InfiniteScroll>` requires this prop — it throws at mount if the page object has no
`scrollProps` entry matching its `data` name, so `merge()` is not a substitute.

The prop is registered for merging automatically, using the direction the client asks for
via `X-Inertia-Infinite-Scroll-Merge-Intent` (append when scrolling down, prepend when
scrolling up). A request without that header is treated as a fresh load and flags the
client to reset the accumulated collection.

Use `.setMatchOn(field)` so refetched pages reconcile by identity instead of duplicating:

```ts
c.var.inertia.render('Feed', {
  posts: scroll(rows, metadata).setMatchOn('id'),
})
```

Without it, a partial reload that returns a page the client already holds appends a second
copy of those rows. With it, matching rows are updated in place. Pass the field name on its
own — the prop key is prefixed for you (`posts` + `id` → `posts.id`).

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

// Infinite scroll reconciling rows by id
scroll(rows, metadata).setMatchOn('id')
```

## External redirects

Redirect to a non-Inertia URL (returns 409 for Inertia requests, 302 for regular):

```ts
app.get('/download', (c) => {
  return c.var.inertia.location('https://example.com/file.pdf')
})
```

Validate any user-supplied URL before passing it to `location()` or `redirect()` to avoid open redirects (see [Security](#security)).

## Asset versioning

Every Inertia response carries `page.version`. When a client's `X-Inertia-Version` header no longer matches the server's version, the adapter answers a GET with `409` + `X-Inertia-Location`, and the client performs a full page visit — picking up the new HTML and the new asset URLs. This is what stops a tab that was open across a deploy from requesting content-hashed chunks that no longer exist.

Derive the version from your Vite manifest with `manifestVersion`:

```ts
import manifest from './dist/client/.vite/manifest.json'
import { inertia } from '@brachkow/hono-inertia'
import { manifestVersion } from '@brachkow/hono-inertia/vite'

app.use(inertia({ version: manifestVersion(manifest), render }))
```

- It hashes the **sorted emitted filenames** (sha256, 16 hex chars), not the manifest JSON — filenames are already content-hashed, so the version changes exactly when an open tab's chunk URLs go dead. A server-only deploy does not force-reload every open tab (a commit SHA or deployment ID would over-invalidate). Manifest key reordering or metadata churn doesn't spuriously invalidate anything.
- The thunk is memoized — the hash is computed once per isolate, not per request. FS-free and WebCrypto-only, so it works on Workers, Deno, Bun, and Node.
- `manifestVersion(manifest, salt)` — bump the salt to force a global reload after a server-only change that breaks the prop contract with old bundles.
- Under `vite dev` no manifest exists — use a constant in development (e.g. `version: import.meta.env.PROD ? manifestVersion(manifest) : 'dev'`).

Whatever you use as a version, **keep it short**: the client echoes it back verbatim as the `X-Inertia-Version` request header on every visit, and proxies reject requests with headers over ~8–16 KB (Cloudflare: 16 KB). Never use the manifest contents themselves.

Omitting `version` disables the check entirely (`page.version` is `null`). A missing or empty client header also never 409s.

### Recovering from dead chunks (`vite:preloadError`)

The 409 mechanism covers chunks loaded through an Inertia GET. It structurally cannot cover dynamic imports that aren't tied to a visit (`import('some-lib')` on a button click), or the race where a deploy lands *after* the version check passed but *before* the `import()` fired. The standard net is an app-side `vite:preloadError` listener that navigates once — Vite dispatches it for failing dynamic imports, not just preload links:

```ts
import { router } from '@inertiajs/vue3' // or react / svelte

let pendingUrl: string | null = null
router.on('start', (event) => {
  pendingUrl = event.detail.visit.url.href
})

const RELOADED_AT = 'inertia:chunk-reload'
const COOLDOWN_MS = 10_000

const sessionStorageUsable = () => {
  try {
    window.sessionStorage.getItem(RELOADED_AT)
    return true
  } catch {
    return false
  }
}

window.addEventListener('vite:preloadError', (event) => {
  if (!sessionStorageUsable()) return
  const last = Number(sessionStorage.getItem(RELOADED_AT) ?? 0)
  if (Date.now() - last < COOLDOWN_MS) return
  sessionStorage.setItem(RELOADED_AT, String(Date.now()))
  event.preventDefault()
  window.location.assign(pendingUrl ?? window.location.href)
})
```

Four details are load-bearing:

1. **Navigate to the *target* URL, not the current one.** Inertia resolves the page component *before* it pushes history state, so when the chunk fails the address bar still shows the old page. A bare `location.reload()` re-renders the page the user was already on and the click looks like a no-op — take the pending URL from `router.on('start')`.
2. **Persist the cooldown timestamp; don't use an in-memory or boot-cleared flag.** The reload loop happens *across* documents, and the entry chunk always boots fine (only the view chunk 404s), so anything reset on boot re-arms the loop forever.
3. **Use `sessionStorage`, not `localStorage`.** Staleness is a property of one tab's document; `localStorage` would let one tab's reload suppress another tab's needed one. Accessing `window.sessionStorage` itself throws in blocked/partitioned-storage contexts — probe it and fail closed (let the error surface rather than loop).
4. **Only call `preventDefault()` on the path that actually navigates.** Suppressing the event otherwise makes the import resolve to `undefined` and the caller throws a `TypeError` anyway.

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

`clearHistory()` survives redirects. The flag itself can only travel on a rendered page object, and logout handlers redirect — so when a handler calls `clearHistory()` and then redirects (plain `c.redirect()`, the 302→303 conversion, `c.var.inertia.redirect()`, or `location()`), the middleware flashes it in a short-lived first-party cookie (`inertia_clear_history`: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=60`) and the redirect target's response carries `clearHistory: true` automatically. This mirrors Laravel's session-flashed `clearHistory`. Two caveats: the redirect target must be handled by this middleware (otherwise the cookie just expires), and `Path=/` means multiple apps on one origin share the flag.

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

That requirement fails **silently**: `window.crypto.subtle` is undefined in non-secure contexts (e.g. testing over a plain-http LAN IP from a phone), and the Inertia client then logs "Encryption is not supported in this environment. SSL is required." and stores history **in plaintext**. `localhost` counts as a secure context, so this only bites on non-localhost HTTP.

Encryption alone doesn't cover the back button either — see the back/forward cache note under [Caching](#caching). A complete logout looks like:

```ts
app.post('/logout', (c) => {
  deleteCookie(c, 'session')        // 1. end the session
  c.var.inertia.clearHistory()      // 2. rotate the history encryption key
  return c.redirect('/login')       //    (flashed across the redirect)
})
```

with `encryptHistory` enabled on authenticated pages, plus `Cache-Control: no-store` and a `pageshow` guard on those pages if bfcache restoration matters to you (below).

### Redirects

`location()` and `redirect()` send the URL you pass straight to the browser. Never pass unvalidated user input (e.g. a `?next=` parameter) to them — validate against an allowlist or restrict to same-origin paths first — or you create an open redirect.

### Caching

Adapter-emitted responses (Inertia JSON, initial HTML, 409s) carry `Cache-Control: private, no-cache, must-revalidate` by default:

- Without a `Cache-Control` header, browsers apply heuristic freshness to the HTML document. After a deploy, the full-page reload triggered by a 409 version mismatch could then be served the *same stale document* from cache — silently defeating asset versioning. The header is a prerequisite for the 409 mechanism to work.
- `private`: the rendered HTML embeds per-user props (session, auth) in `data-page`; a shared cache or CDN must never store it.
- `no-cache` (store but revalidate) rather than `no-store`, which would disable the back/forward cache and turn every back-navigation into a full load.

Override the value with `cacheControl: '…'`, or opt out with `cacheControl: false`. On initial HTML responses, a `Cache-Control` set in the handler (via `c.header()`) before `render()` takes precedence. Inertia JSON and 409 responses are constructed fresh and always use the config value — for a per-route override, set the header on the returned response:

```ts
app.get('/pricing', async (c) => {
  const res = await c.var.inertia.render('Pricing', { plans })
  res.headers.set('Cache-Control', 'public, max-age=300')
  return res
})
```

Responses the adapter doesn't emit (your own routes) are never touched.

**Back/forward cache.** The `no-cache` default does *not* keep pages out of the browser's back/forward cache — bfcache snapshots the fully rendered page, so Safari and Firefox can restore an authenticated page on Back after logout regardless of history encryption (encryption protects the stored history *state*, not the rendered snapshot). `no-store` disqualifies the page from bfcache in Firefox and Chromium, but Safari may bfcache even `no-store` pages, so pair a per-route `no-store` on authenticated pages with a client-side guard:

```js
window.addEventListener('pageshow', (e) => {
  if (e.persisted) window.location.reload()
})
```

Note for testing: Chromium automation (`page.goBack()` in Playwright) exercises `popstate`, not bfcache — a passing Chromium test proves nothing about the Safari/Firefox Back behavior.

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
