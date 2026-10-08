# @brachkow/hono-inertia

> How stable is it? It has powered [Things To Have](https://thingstohave.app) in production since early 2026 with 0 issues

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
  <script data-page="app" type="application/json">${serializePage(page)}</script>
  <div id="app"></div>
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
  // Asset version, as a string or a sync/async function. Derive it from your
  // Vite manifest with manifestVersion (see Asset versioning below). Omit it
  // to disable version checks.
  version: manifestVersion(manifest),

  // HTML render function. Receives the page object, view data, the SSR result
  // (undefined without SSR), and the Hono context.
  // Embed the page in a <script data-page="app" type="application/json"> tag with
  // serializePage(page), never a bare JSON.stringify. See Security below.
  render: (page, viewData, ssr, c) => {
    if (ssr) {
      return `<html><head>${ssr.head}</head><body>${ssr.body}</body></html>`
    }
    return `<html><body><script data-page="app" type="application/json">${serializePage(page)}</script><div id="app"></div></body></html>`
  },

  // Global shared props, merged into every response
  share: (c) => ({
    auth: { user: getUser(c) },
  }),

  // Optional. Posts the page object to an Inertia SSR server, or pass
  // { render } to render in the same process (see SSR below)
  ssr: {
    url: 'http://127.0.0.1:13714',
    enabled: true,
  },

  // Called when SSR fails and the page falls back to client-side rendering.
  // Defaults to console.error. Throw from it to fail the request instead.
  onSsrError: (error, page) => logger.error({ error, component: page.component }),

  // Cache-Control for responses the adapter emits (see Caching under Security).
  // Defaults to 'private, no-cache, must-revalidate'. Set false to omit it.
  cacheControl: 'private, no-cache, must-revalidate',

  // Called when a deferred(fn).rescue() prop throws (see deferred under Prop types).
  // Defaults to console.error.
  onRescue: (error, prop) => logger.error({ error, prop }),
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

Props can be lazy functions. The adapter calls them only when the response includes the prop:

```ts
app.get('/dashboard', (c) => {
  return c.var.inertia.render('Dashboard', {
    stats: async () => computeExpensiveStats(),
    users: () => db.users.findMany(),
  })
})
```

### BigInt props

Props and flash data can hold `BigInt` values, such as 64-bit IDs from a `bigint` column. JSON has no BigInt, so the adapter sends each one as a `{ "$bigint": "<digits>" }` marker and sets `preserveBigIntegers: true` on the page. The Inertia client (3.8+) turns the markers back into `BigInt` values on initial visits, Inertia requests, SSR and history restores. Pages without a `BigInt` are sent unchanged:

```ts
app.get('/orders/:id', async (c) => {
  return c.var.inertia.render('Orders/Show', {
    id: 900719925474099988n, // arrives in the component as a BigInt
  })
})
```

Older clients receive the markers as plain objects. A `BigInt` that the client sends back through the router or a form arrives as a numeric string.

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

Included in every response, including partial reloads:

```ts
import { always } from '@brachkow/hono-inertia'

c.var.inertia.render('Dashboard', {
  auth: always({ user: currentUser }),
})
```

### `optional(fn)`

Excluded from initial visits. Included only when a partial reload requests it:

```ts
import { optional } from '@brachkow/hono-inertia'

c.var.inertia.render('Users/Index', {
  permissions: optional(() => fetchPermissions()),
})
```

### `deferred(fn, group?)`

Excluded from the initial response. The client fetches the prop after mount:

```ts
import { deferred } from '@brachkow/hono-inertia'

c.var.inertia.render('Dashboard', {
  stats: deferred(() => computeStats()),
  comments: deferred(() => fetchComments(), 'sidebar'),
  likes: deferred(() => fetchLikes(), 'sidebar'),
})
```

Chain `.rescue()` so one failing deferred prop does not fail the whole response. If the function throws, the adapter passes the error to the `onRescue` config callback (default `console.error`), sends the prop as `null`, and lists its key in `page.rescuedProps`. The client's `<Deferred>` component then renders its `rescue` slot (or the fallback) instead of the default content:

```ts
c.var.inertia.render('Dashboard', {
  stats: deferred(() => computeStats()).rescue(),
})
```

### `merge(value)` / `prepend(value)` / `deepMerge(value)`

The client appends, prepends, or deep-merges new data instead of replacing it. Use these for feeds that load more data over time:

```ts
import { merge, prepend, deepMerge } from '@brachkow/hono-inertia'

c.var.inertia.render('Feed', {
  posts: merge(() => fetchPosts(page)),
  newPosts: prepend(() => fetchNewPosts()),
  settings: deepMerge(() => fetchSettings()),
})
```

Use `.setMatchOn(field)` to match array items by a field:

```ts
c.var.inertia.render('Feed', {
  posts: merge(() => fetchPosts()).setMatchOn('id'),
})
```

### `scroll(value, metadata)`

`scroll()` provides the data for the client's `<InfiniteScroll>` component. `value` is the array of rows for the
current page. You pass the pagination state separately as a `ScrollMetadata` adapter:

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

`<InfiniteScroll>` requires this prop. It throws at mount if the page object has no
`scrollProps` entry matching its `data` name, so `merge()` is not a substitute.

The adapter registers the prop for merging and takes the direction from the client's
`X-Inertia-Infinite-Scroll-Merge-Intent` header (append when scrolling down, prepend when
scrolling up). The adapter treats a request without that header as a fresh load and tells the
client to reset the accumulated collection.

Use `.setMatchOn(field)` so refetched pages update existing rows instead of duplicating them:

```ts
c.var.inertia.render('Feed', {
  posts: scroll(rows, metadata).setMatchOn('id'),
})
```

Without it, a partial reload that returns a page the client already holds appends a second
copy of those rows. With it, the client updates matching rows in place. Pass the field name on
its own. The adapter prefixes it with the prop key (`posts` and `id` become `posts.id`).

### `once(fn, key?, expiresAt?)`

The adapter resolves it once, and the client caches it across navigations:

```ts
import { once } from '@brachkow/hono-inertia'

c.var.inertia.render('Pricing', {
  plans: once(() => fetchPlans()),
  config: once(() => fetchConfig(), 'app-config', 86400),
})
```

### Chaining

You can combine prop types:

```ts
// Deferred + merge + once
deferred(() => fetchFeed(), 'main').merge().once()

// Deferred + prepend
deferred(() => fetchNew(), 'top').prepend()

// Optional + once
optional(() => fetchExpensiveData()).once('cache-key', 3600)

// Deep merge with match key
deepMerge(() => fetchItems()).setMatchOn('id')

// Infinite scroll matching rows by id
scroll(rows, metadata).setMatchOn('id')
```

## Status codes

`render()` responds with 200 by default. Set another status with `c.status()` before rendering. It applies to both initial visits and Inertia requests, and the client renders the page for any status:

```ts
app.notFound((c) => {
  c.status(404)
  return c.var.inertia.render('Error', { status: 404 })
})
```

## External redirects

Redirect to a non-Inertia URL. Inertia requests get a 409, regular requests get a 302:

```ts
app.get('/download', (c) => {
  return c.var.inertia.location('https://example.com/file.pdf')
})
```

Validate any user-supplied URL before passing it to `location()` or `redirect()` to avoid open redirects (see [Security](#security)).

## Asset versioning

Every Inertia response carries `page.version`. When a client's `X-Inertia-Version` header no longer matches the server's version, the adapter answers a GET with `409` and `X-Inertia-Location`, and the client performs a full page visit, which loads the new HTML and asset URLs. This keeps a tab that stayed open across a deploy from requesting content-hashed chunks that no longer exist.

The 409 also carries the new version in `X-Inertia-Version`. The client uses it to tell a deploy-driven reload from a plain `location()` redirect. It fires a cancelable `inertia:location` event with `versionChange: true`. For background `async` visits (polling, prefetching, deferred props) it skips the forced reload, so the next visit the user starts picks up the new assets without interrupting them.

Derive the version from your Vite manifest with `manifestVersion`:

```ts
import manifest from './dist/client/.vite/manifest.json'
import { inertia } from '@brachkow/hono-inertia'
import { manifestVersion } from '@brachkow/hono-inertia/vite'

app.use(inertia({ version: manifestVersion(manifest), render }))
```

- It hashes the sorted emitted filenames (sha256, 16 hex chars), not the manifest JSON. Vite already puts content hashes in filenames, so the version changes exactly when an open tab's chunk URLs stop working. A server-only deploy does not force-reload every open tab, as a commit SHA or deployment ID would. Reordered manifest keys or changed metadata don't change the version.
- `manifestVersion` computes the hash once per isolate and memoizes it. It doesn't touch the file system and uses only WebCrypto, so it works on Workers, Deno, Bun, and Node.
- Pass a salt as the second argument, `manifestVersion(manifest, salt)`, and change it to force a global reload after a server-only change that breaks the prop contract with old bundles.
- `vite dev` produces no manifest, so use a constant in development, for example `version: import.meta.env.PROD ? manifestVersion(manifest) : 'dev'`.

Whatever you use as a version, keep it short. The client sends it back verbatim in the `X-Inertia-Version` request header on every visit, and proxies reject requests with headers over about 8 to 16 KB (Cloudflare: 16 KB). Never use the manifest contents themselves.

Omitting `version` disables the check (`page.version` is `null`). A missing or empty client header never triggers a 409 either.

### Recovering from dead chunks (`vite:preloadError`)

The 409 mechanism covers chunks loaded through an Inertia GET. It can't cover dynamic imports unrelated to a visit (`import('some-lib')` on a button click), or a deploy that lands after the version check passed but before the `import()` ran. For those cases, add a `vite:preloadError` listener in the app that navigates once. Vite dispatches this event for failing dynamic imports, not only for preload links:

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

Four details matter:

1. **Navigate to the target URL, not the current one.** Inertia resolves the page component before it pushes history state, so when the chunk fails, the address bar still shows the old page. A bare `location.reload()` re-renders the page the user was already on, and the click appears to do nothing. Take the pending URL from `router.on('start')`.
2. **Persist the cooldown timestamp instead of using an in-memory flag or one cleared on boot.** The reload loop happens across documents, and the entry chunk always boots (only the view chunk returns 404), so any flag reset on boot lets the loop run forever.
3. **Use `sessionStorage`, not `localStorage`.** Staleness belongs to one tab's document. With `localStorage`, one tab's reload would suppress a reload another tab needs. Accessing `window.sessionStorage` throws in blocked or partitioned storage contexts, so probe it and fail closed by letting the error surface instead of looping.
4. **Call `preventDefault()` only on the path that navigates.** Otherwise the import resolves to `undefined` and the caller throws a `TypeError` anyway.

## History encryption

By default, Inertia stores page state unencrypted in browser history. Encrypt it on pages that render sensitive data, so the back button doesn't expose it after logout (see [Security](#security)). Per request:

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

Clear encrypted history, for example on logout:

```ts
app.post('/logout', (c) => {
  c.var.inertia.clearHistory()
  return c.redirect('/login')
})
```

`clearHistory()` works on any response. The flag can only travel on a rendered page object, but logout handlers usually redirect or answer with 204. When a handler calls `clearHistory()` and returns anything other than a page (a redirect, a 409 from `redirect()` or `location()`, a 204, or JSON), the middleware stores the flag in a short-lived first-party cookie (`inertia_clear_history`: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=60`). The next rendered page then carries `clearHistory: true`. Laravel does the same by keeping the flag in the session. There are two caveats. This middleware must render the next page, otherwise the cookie expires unused. And with `Path=/`, multiple apps on one origin share the flag.

## View data

Pass data to the render function without exposing it to client-side JavaScript:

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
  <body><script data-page="app" type="application/json">${serializePage(page)}</script><div id="app"></div></body>
  </html>
`
```

The render function also receives the Hono context, so it can read request state such as a CSP nonce or a cookie:

```ts
render: (page, viewData, ssr, c) => `
  <html>
  <head><script nonce="${c.get('cspNonce')}">/* … */</script></head>
  <body><script data-page="app" type="application/json">${serializePage(page)}</script><div id="app"></div></body>
  </html>
`
```

## Flash messages

Send one-shot messages (toasts, alerts) to the client. The client passes them to the `onFlash` callback and the `inertia:flash` event on the next render, including the initial visit. Then it clears them from history so they don't replay on back/forward:

```ts
app.post('/users', async (c) => {
  await createUser(c)
  c.var.inertia.flash({ success: 'User created' })
  return c.var.inertia.render('Users/Index', { users })
})
```

`flash()` accumulates across calls, and later keys win. Flash data is a top-level field and never mixes into your props.

The adapter has no session, so `flash()` applies to the current response only. To show a message after a redirect (POST, then redirect, then GET), persist it across the redirect yourself, for example in a short-lived cookie, and apply it again in middleware:

```ts
app.use(async (c, next) => {
  const flash = readFlashCookie(c) // your own helper
  if (flash) c.var.inertia.flash(flash)
  await next()
})
```

## DevTools

The [Inertia DevTools](https://inertiajs.com/docs/devtools) browser extension records every request in its own panel: which props the server returned and how they were wrapped, request and response bodies, and timing. The adapter implements the server side of the [DevTools protocol](https://inertiajs.com/docs/devtools-protocol). Enable it in development only:

```ts
inertia({
  devtools: process.env.NODE_ENV !== 'production',
})
```

With it on, every response carries an `X-Inertia-Devtools-Id` header, the adapter injects a `<script data-inertia-devtools-id>` tag before `</body>` in the initial HTML, and it serves entries from `GET /_inertia/devtools/entries/:id` (and `/_inertia/devtools/entries` with `component`, `type`, `exclude`, `offset` and `limit` filters). The client needs `dev: true` in `createInertiaApp()` for visit grouping.

Entries record the page object, the resolved prop values, the matched Hono route path, and request and response headers and bodies. Before storing an entry, the adapter replaces sensitive keys (`password`, `token`, `secret`, …) and headers (`cookie`, `authorization`, …) with `[REDACTED]`, and summarizes uploads as `{ name, size, mimeType }`. Recording never affects your response. If anything in it fails, the adapter drops the entry and returns your response unchanged.

Options, all optional:

```ts
import { createMemoryDevtoolsStore } from '@brachkow/hono-inertia'

inertia({
  devtools: {
    // Gate the read endpoints. Every request is allowed when omitted.
    authorize: (c) => c.req.header('X-Dev-Token') === process.env.DEV_TOKEN,
    // Path the app is served from when it is not the origin root.
    basePath: '/portal',
    // Each list replaces the default one.
    redact: { keys: ['password', 'ssn'], headers: ['cookie', 'authorization'] },
    // Entries kept per browser tab (default 100) and lifetime in ms (default 24h).
    store: createMemoryDevtoolsStore({ limit: 50, ttl: 60 * 60 * 1000 }),
    // Source path for the "open in editor" link of a page component.
    componentPath: (name) => `resources/js/Pages/${name}.vue`,
  },
})
```

The default store keeps entries in memory, per `inertia()` instance. This works for a local `node`, `bun` or `wrangler dev` server. A setup with multiple isolates or processes that must share entries can pass a `DevtoolsStore` (`set`, `get`, `all` newest first, sync or async) backed by KV, a Durable Object, or any other storage.

The adapter injects the initial-load tag by rewriting the HTML response, so your template needs a `</body>` and the body must not be streamed. Hono doesn't expose route names or handler source locations, so the panel's Route tab shows only the matched path.

## Server-provided head elements

The client can take `<head>` elements from a prop (client 3.5+). Pass an array of raw HTML strings as `head`, and enable it on the client with `serverHead: true`:

```ts
app.get('/users/:id', async (c) => {
  const user = await db.users.find(c.req.param('id'))
  return c.var.inertia.render('Users/Show', {
    user,
    head: [
      `<title>${escapeHtml(user.name)}</title>`,
      `<meta name="description" content="${escapeHtml(user.bio)}">`,
      `<link data-inertia="canonical" rel="canonical" href="https://example.com/users/${user.id}">`,
    ],
  })
})
```

```ts
createInertiaApp({
  serverHead: true, // or a prop name, or (page) => string[]
})
```

`head` is an ordinary prop. The adapter sends it on every visit, the client re-syncs it on navigation, SSR renders it, and you can share it via `share`. The client inserts the strings as-is, so escape every interpolated value with `escapeHtml`. The client keys elements by array position. Set your own `data-inertia` key to give an element a stable identity (for a script that must not re-run on every visit), or to let a page-level `<Head>` override a server default with the same key.

## SSR

The adapter server-renders initial visits in one of two ways. It posts the page object to an Inertia SSR server, or it calls an SSR render function in the same process. It never server-renders Inertia requests, which are in-app navigations. Either way, your `render` function receives the result as `ssr`, with `ssr.head` already joined into one string. When SSR fails, `ssr` is `undefined` and the page renders client-side:

```ts
render: (page, viewData, ssr) => {
  if (ssr) {
    return `<html><head>${ssr.head}</head><body>${ssr.body}</body></html>`
  }
  return `<html><body><script data-page="app" type="application/json">${serializePage(page)}</script><div id="app"></div></body></html>`
},
```

### With an Inertia SSR server

This works with the Node server that `@inertiajs/vite` builds from your SSR entry (`createServer` from `@inertiajs/vue3/server`, `@inertiajs/react/server` or `@inertiajs/svelte/server`):

```ts
inertia({
  ssr: {
    url: 'http://127.0.0.1:13714', // default
    timeout: 5000, // ms before falling back to client-side rendering (default 5000)
    maxResponseBytes: 2_000_000, // default
  },
  render,
})
```

### In the same process (Cloudflare Workers)

Workers can't run Inertia's Node SSR server, so the Worker imports the SSR entry and the adapter calls it directly. `ssr.render` receives the page object and returns `{ head: string[], body: string }`, the same result an Inertia SSR entry returns. The setup below uses Vue and `@cloudflare/vite-plugin`. The plugin runs the Worker in workerd during `vite dev` and builds it with Vite, so the Worker can import `.vue` files.

```bash
pnpm add vue @inertiajs/vue3 @inertiajs/core
pnpm add -D vite @vitejs/plugin-vue @inertiajs/vite @cloudflare/vite-plugin wrangler
```

Configure Vite in `vite.config.ts`. The Cloudflare plugin names the Worker's environment after the `name` in your Wrangler config, with dashes replaced by underscores (`my-app` becomes `my_app`):

```ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import inertia from '@inertiajs/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

export default defineConfig({
  // ssr: false stops @inertiajs/vite from bundling its Node SSR server into the Worker
  plugins: [vue(), inertia({ ssr: false }), cloudflare()],
  builder: {
    // The Worker reads the client manifest, so the client has to build first
    async buildApp(builder) {
      await builder.build(builder.environments.client)
      await builder.build(builder.environments.my_app)
    },
  },
  environments: {
    client: {
      build: {
        manifest: true,
        rollupOptions: { input: 'src/client.ts' },
      },
    },
  },
})
```

The SSR entry, `src/ssr.ts`, resolves pages with `import.meta.glob` instead of the `pages` shorthand. When the Worker transforms an entry that uses `pages`, `@inertiajs/vite` warms up the page files for the browser before Vite has pre-bundled the client's dependencies. The browser then loads two copies of `@inertiajs/vue3` in dev. The `pages` shorthand is fine in `src/client.ts`.

```ts
import { createInertiaApp } from '@inertiajs/vue3'
import type { Page } from '@inertiajs/core'
import type { PageObject } from '@brachkow/hono-inertia'
import { createSSRApp, h } from 'vue'
import type { DefineComponent } from 'vue'
import { renderToString } from 'vue/server-renderer'

const pages = import.meta.glob<DefineComponent>('./pages/*.vue', { import: 'default' })

export default (page: PageObject) =>
  createInertiaApp({
    // Inertia's Page type also requires client-only state (rememberedState) that no server sends
    page: page as Page,
    render: renderToString,
    resolve: (name) => pages[`./pages/${name}.vue`](),
    setup: ({ App, props, plugin }) => createSSRApp({ render: () => h(App, props) }).use(plugin),
  })
```

The Worker, `src/worker.ts`, inlines the client manifest in production and builds the asset tags and the asset version from it. In dev, it loads the client from the Vite dev server:

```ts
import { Hono } from 'hono'
import { inertia, serializePage } from '@brachkow/hono-inertia'
import { manifestVersion } from '@brachkow/hono-inertia/vite'
import type { InertiaEnv } from '@brachkow/hono-inertia'
import renderPage from './ssr'

type Manifest = Record<string, { file: string; css?: string[] }>

const manifest = import.meta.env.PROD
  ? Object.values(
      import.meta.glob<Manifest>('../dist/client/.vite/manifest.json', { eager: true, import: 'default' }),
    )[0]
  : undefined

const assetTags = manifest
  ? [
      `<script type="module" src="/${manifest['src/client.ts'].file}"></script>`,
      ...(manifest['src/client.ts'].css ?? []).map((file) => `<link rel="stylesheet" href="/${file}">`),
    ].join('')
  : '<script type="module" src="/@vite/client"></script><script type="module" src="/src/client.ts"></script>'

const app = new Hono<InertiaEnv>()

app.use(
  inertia({
    version: manifest ? manifestVersion(manifest) : 'dev',
    ssr: { render: renderPage },
    render: (page, viewData, ssr) =>
      ssr
        ? `<!DOCTYPE html><html><head>${ssr.head}${assetTags}</head><body>${ssr.body}</body></html>`
        : `<!DOCTYPE html><html><head>${assetTags}</head><body><script data-page="app" type="application/json">${serializePage(page)}</script><div id="app"></div></body></html>`,
  }),
)

app.get('/', (c) => c.var.inertia.render('Home', { name: 'Workers' }))

export default app
```

`wrangler.jsonc` points `main` at `src/worker.ts`. `vite dev` runs the app, `vite build` builds both environments, and `wrangler deploy` deploys the output.

### When SSR fails

When SSR fails, the adapter calls `onSsrError(error, page)` and renders the page client-side. SSR fails when the SSR server is unreachable, times out, or returns an error or an invalid result, and when `ssr.render` throws. With an Inertia SSR server, `error.cause` holds the server's error details (`error`, `type`, `hint`, `stack`). The default handler logs with `console.error`. Throw from `onSsrError` to fail the request instead, which is useful in E2E tests:

```ts
inertia({
  ssr: { render: renderPage },
  onSsrError: (error) => {
    throw error
  },
  render,
})
```

A common cause is a component that touches a browser API (`window`, `document`, `localStorage`) during render. Wrap it in Inertia's `<WhenMounted>` (client 3.8+), which renders its `fallback` on the server and its children only after mounting in the browser.

The fallback looks the same to people, because the client renders the page after load. Crawlers get an empty `<div id="app"></div>`. Add a test that requests a page and checks the HTML for `data-server-rendered="true"`, so a broken SSR build fails CI instead of shipping.

### Module state is shared between requests

An in-process SSR entry stays loaded across requests in the same isolate. Module-level state in client code, such as a store created at import time, carries over from one request to the next. Create request-scoped state inside components or `setup`, not at module level.

## Security

This adapter follows Inertia's official conventions, but some security work is up to you. Embed the page object with `serializePage`, escape user-controlled view data with `escapeHtml`, and add CSRF protection.

### Embedding the page object (XSS)

The Inertia client boots from a `<script data-page="app" type="application/json">` tag. Always fill it with `serializePage(page)`, never a bare `JSON.stringify(page)`. `JSON.stringify` does not escape `<`, so a prop value containing `</script>` or `<!--` (a username, comment, search term, or validation message) would end the script element early and run as HTML or JavaScript. `serializePage` escapes `<` and `>` as JSON unicode escapes, and the client parses them back unchanged.

Do not HTML-escape the output and do not put it in an attribute. Script content is raw text, so entities like `&quot;` would corrupt the JSON, and the client does not read a `data-page` attribute.

```ts
import { serializePage } from '@brachkow/hono-inertia'

render: (page) => `<script data-page="app" type="application/json">${serializePage(page)}</script><div id="app"></div>`
```

For any other user-influenced value you interpolate into HTML yourself, such as view data in a `<title>`, use `escapeHtml`:

```ts
import { escapeHtml } from '@brachkow/hono-inertia'

render: (page, viewData) =>
  `<title>${escapeHtml(String(viewData.title))}</title>
   <script data-page="app" type="application/json">${serializePage(page)}</script>
   <div id="app"></div>`
```

### CSRF

This adapter does not provide CSRF protection, and the `X-Inertia` header is not a substitute for it. Add CSRF middleware for state-changing requests. With Hono:

```ts
import { csrf } from 'hono/csrf'

app.use(csrf())
```

The Inertia client (axios) reads the `XSRF-TOKEN` cookie and sends it back in an `X-XSRF-TOKEN` header, so a scheme that sets a cookie token and verifies the header works without extra client code.

### History encryption

By default, Inertia stores page state unencrypted in browser history, so a user who presses Back after logging out can still read the previous page's props. Encrypt history on pages with sensitive data, per request with `c.var.inertia.encryptHistory()` or globally with `inertia({ encryptHistory: true })`. Encryption uses the Web Crypto API and requires HTTPS.

Without HTTPS, encryption fails silently. `window.crypto.subtle` is undefined in non-secure contexts, for example when you test from a phone over plain HTTP on a LAN IP. The Inertia client then logs "Encryption is not supported in this environment. SSL is required." and stores history in plaintext. `localhost` counts as a secure context, so this only happens on non-localhost HTTP.

Encryption alone doesn't protect the back button either. See the back/forward cache note under [Caching](#caching). A complete logout looks like this:

```ts
app.post('/logout', (c) => {
  deleteCookie(c, 'session')        // 1. end the session
  c.var.inertia.clearHistory()      // 2. rotate the history encryption key
  return c.redirect('/login')       //    (flashed across the redirect)
})
```

Enable `encryptHistory` on authenticated pages. If bfcache restoration matters to you, also add `Cache-Control: no-store` and a `pageshow` guard to those pages (see below).

### Redirects

`location()` and `redirect()` send the URL you pass straight to the browser. Never pass unvalidated user input, such as a `?next=` parameter, to them. Validate it against an allowlist or restrict it to same-origin paths first, or you create an open redirect.

### Caching

Responses the adapter emits (Inertia JSON, initial HTML, 409s) carry `Cache-Control: private, no-cache, must-revalidate` by default:

- Without a `Cache-Control` header, browsers apply heuristic freshness to the HTML document. After a deploy, the browser could answer the full-page reload that a 409 triggers with the same stale document from cache, and asset versioning would silently fail. The 409 mechanism needs this header to work.
- `private`, because the rendered HTML embeds per-user props (session, auth) in the page data script, so a shared cache or CDN must never store it.
- `no-cache` (store but revalidate) instead of `no-store`, because `no-store` disables the back/forward cache and turns every back navigation into a full load.

Override the value with `cacheControl: '…'`, or omit the header with `cacheControl: false`. For a per-route override, set the header with `c.header()` before `render()`. It applies to both initial HTML and Inertia JSON responses. 409 responses always use the config value:

```ts
app.get('/pricing', async (c) => {
  c.header('Cache-Control', 'public, max-age=300')
  return c.var.inertia.render('Pricing', { plans })
})
```

The adapter never touches responses it doesn't emit, such as your own routes.

**Back/forward cache.** The `no-cache` default does not keep pages out of the browser's back/forward cache. Bfcache stores a snapshot of the rendered page, so Safari and Firefox can restore an authenticated page on Back after logout, even with history encryption. Encryption protects the stored history state, not the rendered snapshot. `no-store` excludes the page from bfcache in Firefox and Chromium, but Safari may still cache `no-store` pages. Pair a per-route `no-store` on authenticated pages with a client-side guard:

```js
window.addEventListener('pageshow', (e) => {
  if (e.persisted) window.location.reload()
})
```

When testing, keep in mind that Chromium automation (`page.goBack()` in Playwright) triggers `popstate`, not bfcache. A passing Chromium test says nothing about Back behavior in Safari or Firefox.

### SSR

The SSR server is a trust boundary. Your `render` function inserts its `head` and `body` into the HTML as-is, because they are rendered HTML and escaping them would break the page. Only point `ssr.url` at a server you control, such as loopback or an authenticated internal host over HTTPS, and never take it from untrusted input. `ssr.timeout` and `ssr.maxResponseBytes` limit the responses. With `ssr.render`, the HTML comes from your own SSR entry, and the adapter checks only its shape.

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
