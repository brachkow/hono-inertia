# Changelog

Release notes are published on [GitHub Releases](https://github.com/brachkow/hono-inertia/releases). This file holds the draft for the next release.

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

### Fixes

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

**Testing helpers**

- New `@brachkow/hono-inertia/testing` entry with `inertiaRequest()`, `inertiaHeaders()` and `getPage()`, which reads the page from JSON or from the first visit's HTML.

**Protocol**

- 302 to 303 conversion also covers QUERY requests.

**Vite plugin**

- `assetTags` links the single CSS file of a client build with `cssCodeSplit: false`. It used to have no stylesheet at all, so pages rendered unstyled.
- Every tag carries `crossorigin`, as in Vite's own HTML output.
- `assetTagsFor(component)` adds the stylesheets and `modulepreload` links of the rendered page and its imports. Page names map to files through `pages`, or through the new `pageSource` option (`'src/pages/[name].vue'`, with `[name]` allowed more than once).
- The virtual module exports the parsed client `manifest`.
- `pages.export` names the export that holds the app, for Workers entries that default-export a handler object. `pages.name` maps a file to a page name, or skips it with `null`.

### Upgrading

- Replace a hand-rolled flash cookie with `session: cookieSession({ secret })` and call `flash()` before the redirect. The examples show the change.
- Check handlers that return an empty 200 or redirect to a URL with `#` (see Breaking changes).
- Check forms that use `errorBag` (see Breaking changes).
