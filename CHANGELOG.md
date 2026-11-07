# Changelog

The notes of every release, newest first. [GitHub Releases](https://github.com/brachkow/hono-inertia/releases) has the same notes for 2.0.0 and later. Unreleased is the draft for the next release.

## Unreleased

This draft covers sessions, validation, live props, testing helpers and the redirect changes. The other changes on the v4 branch (Hono 4.8+ and Hono 5, the Vite plugin, typed page props) still need their entries.

### Breaking changes

**Error bags follow the protocol**

- An `errors` prop passed to `render()` now reaches the client unchanged when the request sends `X-Inertia-Error-Bag`. Before, the adapter replaced it with `errors[bag]`, and the client then read `[bag]` from that again, so forms that used `errorBag` received `{}`.
- If your handlers return `errors: { [bag]: {...} }` themselves, the client now gets them. If they relied on the adapter picking one bag, return that bag's errors under its name instead, or use `withErrors(errors, bag)`.

**Redirects to a URL with a fragment become a 409**

- On an Inertia request, a redirect whose `Location` contains `#` is now a 409 with `X-Inertia-Redirect`, and the client visits the full URL itself. Before, the client followed the redirect and lost the fragment. Prefetch requests and non-Inertia requests still get the redirect.

**An empty 200 redirects back**

- On an Inertia request, a handler that returns a 200 without a body, such as `c.body(null)`, now gets a redirect to the path of the `Referer` (or `/`). Before, the client received an empty response.

**Renamed and reshaped APIs**

- `scroll(value, metadata)` takes a plain object, `{ page, hasMore }` or `{ page, lastPage }`, and works out the previous and next pages. Cursors pass `previousPage` and `nextPage`, and `pageName` defaults to `'page'`. The `ScrollMetadata` interface with its getter methods is gone.
- `once(fn, key?, expiresAt?)` is `once(fn, { key, ttl })`, and `.once(key?, expiresAt?)` on `optional()` and `deferred()` is `.once({ key, ttl })`. `ttl` is a duration in milliseconds, which the adapter turns into the timestamp the client compares with `Date.now()`.
- `.setMatchOn(field)` is `.matchOn(field | fields)`.
- `c.var.inertia.redirect(url)` is `c.var.inertia.clientRedirect(url)`, so it no longer looks like Hono's `c.redirect()`.
- The prop tag is the registered symbol `Symbol.for('hono-inertia.prop-type')`, not the string key `__hono_inertia_prop_type__`.
- The `CLEAR_HISTORY_COOKIE` export is gone. Nothing in the adapter read it, and it ignored the `flagCookies` prefix.

**Scroll reset follows inertia-laravel**

- A scroll prop's `reset` is `true` only when `X-Inertia-Reset` names it. It used to be `true` on every request without the merge intent header, so every full visit reset the client's scroll state.

**Nested props are resolved**

- Plain objects in props are resolved like the top level: functions inside them are called, prop types inside them work, and a partial reload can name a nested path such as `auth.permissions`. A nested function used to be dropped by JSON. `only: ['user.name']` now sends `{ user: { name } }` instead of the whole `user`, and the client merges it.

### Fixes

- `flash()` with a BigInt before a redirect works with the cookie session. It used to throw in `JSON.stringify` and turn the redirect into a 500.
- `inertiaValidator()` keeps errors for fields named like `Object.prototype` keys, such as `constructor`. It used to throw and answer with a 500.
- A prefetch that redirects no longer writes the session, so it can't replace errors or flash data the next page hasn't shown.
- `inertiaHeaders()` lets a header in `headers` win over a generated one written in another case. Fetch used to join the two values, for example into a version that caused a 409.
- `PageProps` types a `deferred().rescue()` prop as possibly `null`, keeps props for each page a handler chooses with `render(flag ? 'A' : 'B', props)`, and keeps a shared prop's type for routes that don't override it.
- A once prop the client already holds is now listed in `onceProps` when the server leaves it out. The client copies its cached value forward only for props the response lists, so the prop used to be `undefined` on the next page.
- `deferred().once()` and `optional().once()` send once metadata on full visits, and a deferred once prop the client holds is no longer listed in `deferredProps`. It used to be fetched again, skipped by the server, and lost.
- A partial reload that names a once prop sends a fresh value, as in inertia-laravel. It used to send nothing when the client held the prop.
- `preserveFragment()` before a redirect reaches the next rendered page, through a short-lived cookie as with `clearHistory()`. It used to apply only to a page rendered in the same response.
- The documented `once()` example passed a duration as `expiresAt`, which the client reads as a timestamp in milliseconds, so the prop expired at once.
- The version mismatch 409 could send `X-Inertia-Location: //host/path`, a protocol-relative URL to another origin, when the request path started with `//`. The adapter now collapses leading slashes and backslashes in every path it builds into a `Location` or `page.url`. This also affected 3.x.

### Highlights

**Sessions**

- New `session` option. It keeps validation errors and flash data between the request that sets them and the next rendered page. A rendered page clears them, redirects carry them on, and version mismatch 409s and prefetches leave them alone.
- `cookieSession({ secret })` stores them in a signed, `HttpOnly` cookie and works on Cloudflare Workers. `secret` takes a list for rotation (the first signs, all verify) or a function of the context to read `c.env`. It throws when the data does not fit in a cookie.
- Bring another store with the `InertiaSession` interface (`get` without clearing, `set(c, data | null)`).
- `flash()` before a redirect now shows on the next page when the `session` option is set.

**Validation and precognition**

- `c.var.inertia.withErrors(errors, bag?)` stores errors for the next page. Pages get the first message per field, and stored errors follow Laravel's error bag rules.
- `inertiaValidator(target, schema)` validates with any Standard Schema library (Zod, Valibot, ArkType) without a runtime dependency. Failed submits redirect back with the errors, clients that ask for JSON get a 422, and precognition requests get 204 or 422 without running the handler.
- `c.var.inertia.back()` redirects to the path of the `Referer`, and never to another origin. It takes a fallback, or `{ fallback, status, removeQuery }`.

**Live props** (client 3.10+)

- `live(value, { channel, on, throttle? })`, and `.live()` on `always`, `optional`, `deferred` and `once` props, send `page.liveProps` so the client refreshes those props on broadcast events. Merge props cannot be live.
- `broadcastProperties(props)` builds the event payload that delivers values without a reload. `c.var.inertia.socketId()` reads `X-Socket-Id`.
- DevTools entries flag live props with `live: true`.

**Shared props**

- `inertiaShare(fn)` shares props from a middleware that runs after `inertia()`, for example once the session is loaded, and records their type for `PageProps`. It can return `undefined` to share nothing.
- `PageProps` keeps the props a typed middleware shares when `inertia()` has no `share` option or an untyped one. It used to drop all shared props then.
- `SharedProps<typeof app>` gives the shared props without `errors`. The `pages.sharedPageProps` option declares them as `@inertiajs/core`'s `sharedPageProps` in the generated file. With in-process SSR, the SSR entry needs an explicit return type, or TypeScript reports a circular type.

- `PageProps` and `SharedProps` type props as the client receives them after JSON. A `Date` is a `string`, a value with `toJSON()` has its return type, and functions and `undefined` fields are left out. They used to keep the server's types.
- `PageProps` keeps every `render()` of a page in one handler. A render whose props extended another render's used to be dropped, along with its extra props.
- `PageProps` keeps every member when a render's props are a union, such as a conditional spread. It used to keep only the keys all members share.
- `PageProps` keeps the routes that render a page without `errors` when another route renders it with `errors`. Their props used to be typed as `undefined`.

**Vue pages without prop names**

- New `@brachkow/hono-inertia/vue` entry with `usePageProps<'Page'>()`. A Vue page reads its typed props from the current page, without writing out each name in `defineProps`. It needs `@inertiajs/vue3`, an optional peer dependency.
- The generated pages file leaves a Vue page that calls `usePageProps()` and has no `defineProps` out of its props check, and lists it in a comment. In dev, it now regenerates when a `.vue` page changes.
- `RouteProps<'Page'>` gives what the routes of a page send, without shared props and `errors`, for story and test fixtures.
- `<PagePropsProvider page props>` and `providePageProps()` give a subtree its own page props, which `usePageProps()` reads instead of the current page. Stories and component tests render a page with typed props this way, also several times side by side. `vue` is an optional peer dependency.
- The pages file finds `usePageProps()` and `defineProps()` as calls in `<script setup>`, leaving out comments and strings. A comment that mentioned `defineProps` used to put a page back in the props check.

**Less setup**

- `inertia({ assets })` takes the Vite plugin's virtual module (`import * as assets from 'virtual:hono-inertia/assets'`) and gets the version, the asset tags and the SSR entry from it. `render` is optional: without it, a built-in template renders the page, with `template: { lang, title, head, id }`.
- The plugin's new `ssr` option names the SSR entry. Its default export becomes the module's `ssr`, which `inertia({ assets })` renders with. Because the module's type is fixed, an SSR entry passed this way no longer needs an explicit return type.
- `session` takes `cookieSession()`'s options directly: `session: { secret }`.
- `template.lang` takes a function of the page and the context, `template.htmlAttributes` adds attributes to `<html>`, and a `template.head` function also gets the view data and the SSR result. The asset tags come before the SSR head.

**More options**

- `ssr.enabled` takes a function of the context, and `c.var.inertia.ssr(false)` turns SSR off for one response.
- `ssr.fetch` sends the request to an Inertia SSR server another way, such as a Cloudflare service binding.
- `allErrors: true` gives pages every message per field as an array.
- `transformComponent` maps the name `render()` takes to the component name the client resolves.
- `flagCookies` sets the prefix and path of the clearHistory and preserveFragment cookies.
- `merge()` and `deferred()` merge at paths inside the prop with `.append(path, matchOn?)` and `.prepend(path, matchOn?)`, and `matchOn()` takes several fields.

**Testing helpers**

- New `@brachkow/hono-inertia/testing` entry with `inertiaRequest()`, `inertiaHeaders()` and `getPage()`, which reads the page from JSON or from the first visit's HTML.
- `reload(app, page, options)` makes a partial reload of a page, and `loadDeferred(app, page, groups?)` loads its deferred props and merges them into the page.

**Protocol**

- 302 to 303 conversion also covers QUERY requests.

**Vite plugin**

- `assetTags` links the single CSS file of a client build with `cssCodeSplit: false`. It used to have no stylesheet at all, so pages rendered unstyled.
- Every tag carries `crossorigin`, as in Vite's own HTML output.
- `assetTagsFor(component)` adds the stylesheets and `modulepreload` links of the rendered page and its imports. Page names map to files through `pages`, or through the new `pageSource` option (`'src/pages/[name].vue'`, with `[name]` allowed more than once).
- The virtual module exports the parsed client `manifest`.
- `pages.export` names the export that holds the app, for Workers entries that default-export a handler object. `pages.name` maps a file to a page name, or skips it with `null`.

### Upgrading

- Replace `render` and `version` with `assets`, and `ssr: { render }` with the plugin's `ssr` option, unless you need your own HTML. The examples show the change.
- Rename `setMatchOn()` to `matchOn()` and `redirect()` to `clientRedirect()`, and move `scroll()` and `once()` to their option objects. TypeScript points at each call.
- Check pages that read a scroll prop's `reset`, and props that hold functions inside objects (see Breaking changes).

- Replace a hand-rolled flash cookie with `session: cookieSession({ secret })` and call `flash()` before the redirect. The examples show the change.
- Check handlers that return an empty 200 or redirect to a URL with `#` (see Breaking changes).
- Check forms that use `errorBag` (see Breaking changes).

## 3.1.0 (2026-10-08)

### Highlights

**In-process SSR (Cloudflare Workers)**

- New `ssr: { render }` option calls an SSR render function in the same process instead of posting to an Inertia SSR server. It receives the page object and returns `{ head: string[], body: string }`, the same result an Inertia SSR entry returns. Workers can't run Inertia's Node SSR server, so this is how a Worker server-renders.
- The README has a full Cloudflare Workers setup with Vue and `@cloudflare/vite-plugin`: `vite.config.ts`, the SSR entry and the Worker, with production asset tags and `manifestVersion` from the inlined client manifest.

**SSR error reporting**

- New `onSsrError(error, page)` config callback, for both the SSR server and `ssr.render`. The page still falls back to client-side rendering. Throw from it to fail the request instead, for example in E2E tests.
- Errors from an Inertia SSR server keep the server's details (`error`, `type`, `hint`, `stack`) as `error.cause`.
- The `head` and `body` returned by `ssr.render` are validated the same way as an SSR server's response.

**BigInt props (Inertia 3.8)**

- A `BigInt` in props or flash data used to throw in `JSON.stringify` and fail the request with a 500. The adapter now sends each one as a `{ "$bigint": "<digits>" }` marker and sets `preserveBigIntegers: true` on the page, and the 3.8+ client turns the markers back into `BigInt` values. Pages without a `BigInt` are sent unchanged.
- This covers Inertia responses, the initial HTML page, the SSR server request and DevTools entries. `ssr.render` receives the native `BigInt` values.

**Status codes and handler headers**

- `c.status()` set before `render()` now applies to Inertia responses as well as initial visits, so error pages such as `app.notFound` can answer with a 404 on every visit.
- Headers set with `c.header()` before `render()`, such as `Cache-Control`, now apply to Inertia responses too.

**`clearHistory()` on any response**

- `clearHistory()` now carries over to the next rendered page from any non-page response, such as a 204 or JSON, not only from redirects. This matches Laravel, which keeps the flag in the session.

**Hono context in `render`**

- The render function receives the Hono context as a fourth argument: `render(page, viewData, ssr, c)`. Use it for request state such as a CSP nonce or a cookie.

### Upgrading from 3.0

- SSR failures are now logged with `console.error` by default instead of being silent. Pass `onSsrError` to change that.
- `ssr: {}` without a `url` now posts to the default `http://127.0.0.1:13714`, as the README already described. Before, it turned SSR off.
- Headers set with `c.header()` before `render()` now reach Inertia responses, not only the initial HTML.
- `RenderFunction` gained the `c` parameter, and `SsrConfig` is now a union of `SsrHttpConfig` and `SsrRenderConfig` (`url` and `render` can't be combined). Existing render functions and SSR configs keep working.
- New exports: `SsrHttpConfig`, `SsrRenderConfig`, `SsrRenderResult`. `PageObject` gains `preserveBigIntegers`.

## 3.0.0 (2026-09-18)

### Highlights

**Breaking: page data moves to a script tag**

- The Inertia v3 client boots only from `<script data-page="app" type="application/json">` and never reads a `data-page` attribute. `serializePage(page)` now returns script-safe JSON (`<` and `>` escaped as `\u003c` / `\u003e`, matching upstream's initial-page escaping in 3.7.1 and Laravel 3.3.4) instead of HTML-entity-escaped JSON. Entities are not decoded inside a script element, so the old output was invalid there. `escapeHtml` is unchanged and still the tool for view data.

**Inertia DevTools**

- New `devtools` config option implements the server side of the [DevTools protocol](https://inertiajs.com/docs/devtools-protocol): `X-Inertia-Devtools-Id` / `X-Inertia-Devtools-Parent-Out` on every response (a prefetch answers with its own id so it never advances the batch cursor), the discovery `<script data-inertia-devtools-id>` tag injected before `</body>` on the initial load only, and the `GET /_inertia/devtools/entries[/:id]` read API with `component`, `type`, `exclude`, `offset` and `limit` filters.
- Entries carry the page object, per-prop metadata (`shared`, `always` / `optional` / `defer` / `merge` / `scroll` / `once`, merge direction and deep merge, `reset`, `rescued`), resolved prop values, lowercase request/response headers, request and response bodies, redirect target, request type, server timing and the matched Hono route path. Request bodies are cloned before the handler runs, so they are recorded even after `c.req.json()` consumed them; uploads are summarized as `{ name, size, mimeType }`.
- Sensitive keys, headers and query parameters are replaced with `[REDACTED]`. Recording is passive: a failure drops the entry and never touches the response.
- Options: `authorize`, `basePath`, `redact`, `store`, `componentPath`. The default store is in memory per `inertia()` instance, capped per browser tab and pruned by TTL (`createMemoryDevtoolsStore({ limit, ttl })`); pass a `DevtoolsStore` (`set` / `get` / `all`, sync or async) to share entries across isolates.

**Rescuable deferred props**

- `deferred(fn).rescue()`: when the resolver throws, the prop is sent as `null`, listed in `page.rescuedProps` (the client's `<Deferred>` renders its `rescue` slot), and reported through the new `onRescue` config callback (default `console.error`). Non-rescued props still fail the response. Mirrors Laravel's `defer(..., rescue: true)`.

**Inertia 3.7.1 conformance**

- The version-mismatch 409 now carries the new version in `X-Inertia-Version`, so the 3.6+ client fires the cancelable `inertia:location` event with `versionChange: true` and skips the forced reload on background `async` visits (matches Laravel 3.1.1).
- README documents server-provided head elements: a `head: string[]` prop with `serverHead: true` on the client (3.5+), escaping, and `data-inertia` keys for stable identity.

### Upgrading from v2

- Replace `<div id="app" data-page="${serializePage(page)}"></div>` with `<script data-page="app" type="application/json">${serializePage(page)}</script><div id="app"></div>`. Do not HTML-escape the output and do not put it in an attribute. See the README "Security" section.
- `DeferredProp` gains a `shouldRescue: boolean` field; add it if you construct these objects by hand.
- Everything else is additive: `devtools`, `onRescue`, `createMemoryDevtoolsStore`, and the `Devtools*` types.

## 2.3.0 (2026-07-19)

### Highlights

**`scroll()` prop match keys**

- `scroll(value, metadata)` is now chainable with `.setMatchOn(field)`, so a refetched page reconciles by identity instead of appending a duplicate copy of rows the client already holds. Matching rows are updated in place. Pass the field name on its own — the prop key is prefixed for you (`posts` + `id` → `posts.id`). New `ScrollChain` type; `ScrollProp` gains a `matchOn: string | null` field.
- Scroll props now route through the same merge-metadata collection path as `merge()` / `prepend()` / `deepMerge()`, so `matchOn` lands in the page object's match-key list alongside the append/prepend intent from `X-Inertia-Infinite-Scroll-Merge-Intent`.

**Docs**

- README now documents `scroll(value, metadata)`: the `ScrollMetadata` adapter shape, why `<InfiniteScroll>` requires this prop specifically (it throws at mount without a matching `scrollProps` entry, so `merge()` is not a substitute), how merge direction is derived from the client header, and that a header-less request is treated as a fresh load that resets the accumulated collection.

### Upgrading from v2.2

- No breaking changes. `scroll()` returns a `ScrollChain` (a `ScrollProp` plus `setMatchOn`), which is assignable anywhere a `ScrollProp` was before. If you construct `ScrollProp` objects by hand, add `matchOn: null`.

## 2.2.0 (2026-07-17)

### Highlights

**History clearing across redirects**

- `clearHistory()` now survives redirects: the middleware flashes the flag in a short-lived first-party cookie (`inertia_clear_history` — HttpOnly, SameSite=Lax, Max-Age 60) and applies it to the redirect target's page object, mirroring Laravel's session-flashed `clearHistory`. Works for plain `c.redirect()`, the 302→303 conversion, `redirect()` (409 + `X-Inertia-Redirect`), and `location()`. Parallel non-page requests don't consume the flag, redirect chains re-flash it, `clearHistory(false)` cancels it, and prefetches never eat it. New `CLEAR_HISTORY_COOKIE` export.
- 302→303 conversion now explicitly preserves all handler headers, including multiple `Set-Cookie`.

**Docs**

- Security: history encryption silently falls back to plaintext in non-secure contexts (`window.crypto.subtle` unavailable on plain-http LAN IPs; localhost is fine).
- Security: back/forward-cache caveats — the default `no-cache` doesn't keep pages out of bfcache; pair per-route `no-store` with a `pageshow` guard on authenticated pages. A complete logout recipe.

### Upgrading from v2.1

- No breaking changes. After `clearHistory()` + redirect, responses now set the `inertia_clear_history` cookie — worth declaring if you enumerate first-party cookies (compliance scanners, cookie banners). Previously the flag was silently dropped on redirect.

## 2.1.0 (2026-07-14)

### Highlights

**Asset versioning**

- New `manifestVersion()` helper, exported from the `@brachkow/hono-inertia/vite` subpath — derives the asset version from the sorted emitted filenames of an imported Vite manifest (16-char sha256, lazily memoized, WebCrypto-only; works on Workers, Deno, Bun, and Node). The version changes exactly when an open tab's chunk URLs go dead, so server-only deploys don't force-reload every tab. Takes an optional `salt` to force a global reload.
- `version` is now resolved lazily and at most once per request — a version thunk no longer runs on passthrough routes, POSTs, or requests that never render.
- Omitting `version` now emits `page.version: null` and disables version checks entirely, per the Inertia protocol.

**Caching**

- Adapter-emitted responses (Inertia JSON, initial HTML, 409s) now send `Cache-Control: private, no-cache, must-revalidate` by default. Without it, browsers can heuristically cache the HTML document and serve the stale page right back after a 409-triggered reload, silently defeating asset versioning. New `cacheControl: string | false` config option to override or opt out.

**Docs & CI**

- README: new Asset versioning guide (why filenames-not-JSON, why not a commit SHA, header-size limits, and the app-side `vite:preloadError` recovery pattern) and a Security → Caching section.
- GitHub Actions CI running tests and typecheck.

### Upgrading from v2.0

- Responses now carry a default `Cache-Control` header. If you relied on a CDN or browser caching adapter responses, set `cacheControl: false` or provide your own value.
- With no `version` configured, `page.version` is now `null` (was `''`) and a client-sent `X-Inertia-Version` never triggers a 409.
- The README's old `readFileSync` version example is gone — passing manifest contents as the version bloats the `X-Inertia-Version` request header past proxy limits (Cloudflare: 16 KB). Use `manifestVersion(manifest)` instead.

## 2.0.0 (2026-06-16)

### Highlights

**Security**

- Safe page-object serialization via `serializePage` / `escapeHtml` and the HTML-escaped `data-page` render pattern, fixing the XSS exposure in the old `<script>` + `JSON.stringify(page)` pattern.
- Hardened SSR dispatch: request timeout, response size cap, and response-shape validation.

**Inertia v3.4.0 conformance**

- `scrollProps.reset` and infinite-scroll merge-intent (prepend/append).
- Correct `onceProps` key/prop mapping — custom `once()` keys now work.
- Nested dot-notation keys in partial reloads (`only: ['user.name']`).
- Proxy-safe relative `X-Inertia-Location` on version mismatch.
- `PageObject` type completed; new global `encryptHistory` config option.

**Features**

- Flash messages: `c.var.inertia.flash(...)` populates `page.flash`.

### Upgrading from v1

- Render the page object with `serializePage(page)` in a `data-page` attribute instead of `JSON.stringify(page)` in a `<script>` tag — this fixes the XSS exposure and matches the standard Inertia client. See the README "Security" section.
- SSR now times out after 5 s and caps responses at 2 MB by default (configurable via `ssr.timeout` / `ssr.maxResponseBytes`).

## 1.0.0 (2026-04-24)

The first release. It has no published release notes.
