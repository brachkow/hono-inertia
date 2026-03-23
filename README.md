# hono-inertia

Inertia.js v2 server-side adapter for [Hono](https://hono.dev).

## Install

```bash
pnpm add github:brachkow/hono-inertia
```

## Quick start

```ts
import { Hono } from 'hono'
import { inertia } from 'hono-inertia'
import type { InertiaEnv } from 'hono-inertia'

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
  <div id="app" data-page='${JSON.stringify(page)}'></div>
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

  // HTML render function — receives page object, view data, and optional SSR result
  render: (page, viewData, ssr) => {
    if (ssr) {
      return `<html><head>${ssr.head}</head><body>${ssr.body}</body></html>`
    }
    return `<html><body><div id="app" data-page='${JSON.stringify(page)}'></div></body></html>`
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
import { always } from 'hono-inertia'

c.var.inertia.render('Dashboard', {
  auth: always({ user: currentUser }),
})
```

### `optional(fn)`

Excluded from initial visits. Only included when explicitly requested in a partial reload:

```ts
import { optional } from 'hono-inertia'

c.var.inertia.render('Users/Index', {
  permissions: optional(() => fetchPermissions()),
})
```

### `deferred(fn, group?)`

Excluded from the initial response. The client automatically fetches them after mount:

```ts
import { deferred } from 'hono-inertia'

c.var.inertia.render('Dashboard', {
  stats: deferred(() => computeStats()),
  comments: deferred(() => fetchComments(), 'sidebar'),
  likes: deferred(() => fetchLikes(), 'sidebar'),
})
```

### `merge(value)` / `prepend(value)` / `deepMerge(value)`

Client appends/prepends/deep-merges new data instead of replacing. Useful for infinite scroll:

```ts
import { merge, prepend, deepMerge } from 'hono-inertia'

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
import { once } from 'hono-inertia'

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

## History encryption

Encrypt page state in browser history to prevent back-button data exposure:

```ts
app.get('/dashboard', (c) => {
  c.var.inertia.encryptHistory()
  return c.var.inertia.render('Dashboard', { secret: 'data' })
})
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
  <head><title>${viewData.metaTitle}</title></head>
  <body><div id="app" data-page='${JSON.stringify(page)}'></div></body>
  </html>
`
```

## SSR

Configure an Inertia SSR server (works with `@inertiajs/vue3/server`, `@inertiajs/react/server`, `@inertiajs/svelte/server`):

```ts
inertia({
  ssr: {
    url: 'http://127.0.0.1:13714', // default
    enabled: true,
  },
  render: (page, viewData, ssr) => {
    if (ssr) {
      return `<html><head>${ssr.head}</head><body>${ssr.body}</body></html>`
    }
    return `<html><body><div id="app" data-page='${JSON.stringify(page)}'></div></body></html>`
  },
})
```

Falls back to client-side rendering if the SSR server is unavailable.

## TypeScript

Use `InertiaEnv` for typed `c.var.inertia` access:

```ts
import type { InertiaEnv } from 'hono-inertia'

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
