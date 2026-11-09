---
description: Which parts of the Inertia v3 protocol the adapter implements
---

# Protocol support

The adapter implements the Inertia.js v3 protocol, and the lists below say which parts.

## Core protocol

- HTML on the first visit and JSON on Inertia visits, both from [`c.var.inertia.render()`](/guide/rendering)
- Lazy function props that run only when the response includes them
- `Vary: X-Inertia` on every response
- Asset versioning with a 409 and `X-Inertia-Location` on a version mismatch for GET requests, using the Vite plugin or [`manifestVersion`](/guide/assets)
- 302 to 303 conversion after PUT, PATCH, DELETE and QUERY on Inertia requests
- A redirect back to the `Referer` when a handler returns an empty 200, and [`c.var.inertia.back()`](/guide/redirects#redirecting-back) for doing it yourself
- Shared props with the `share` option and per request with [`c.var.inertia.share()`](/guide/shared-data)
- Partial reloads with `X-Inertia-Partial-Data` and `X-Inertia-Partial-Except`. Excluded props never run, and `errors` is always included
- [Validation errors from the session](/guide/validation) with `withErrors()`, shared as `errors` and encoded as `{}` when empty
- [Error bags](/guide/validation#error-bags) with `X-Inertia-Error-Bag`, following Laravel's rules
- [Flash data kept across redirects and version mismatches](/guide/sessions) with the `session` option
- Prop reset with `X-Inertia-Reset`
- [Fragment redirects](/guide/redirects#fragment-redirects). A redirect to a URL with `#` becomes a 409 with `X-Inertia-Redirect`, and `preserveFragment()` keeps the request's fragment
- Custom status codes with [`c.status()`](/guide/redirects#status-codes) before rendering
- XSS-safe page embedding with [`serializePage`](/guide/security#embedding-the-page-object-xss)

## Optional features

- [Always props](/guide/props#always-value) with `always`
- [Optional props](/guide/props#optional-fn) with `optional`
- [Deferred props](/guide/props#deferred-fn-group) with `deferred`, including groups
- Rescued deferred props with `deferred(fn).rescue()`, which reports errors to `onRescue`
- [Merge props](/guide/props#merge-value-prepend-value-deepmerge-value) with `merge`, `prepend` and `deepMerge`
- Match keys and merge paths for merged props with `matchOn()`, `append(path)` and `prepend(path)`
- [Infinite scroll](/guide/props#scroll-value-options) with `scroll` and `X-Inertia-Infinite-Scroll-Merge-Intent`
- [Once props](/guide/props#once-fn-options) with `once`, including keys, expiry and `X-Inertia-Except-Once-Props`
- [Combined prop types](/guide/props#chaining), such as `deferred(fn).merge().once()`
- [Nested props](/guide/rendering#nested-props): prop types and lazy functions inside objects, and dot paths in partial reloads
- [Live props](/guide/props#live-value-options) with `live()` or `.live()`, `broadcastProperties()` and `socketId()` (client 3.11+)
- [Precognition](/guide/validation#precognition) with `inertiaValidator()`, which takes any Standard Schema such as Zod, Valibot or ArkType
- [External redirects](/guide/redirects#external-redirects) with `c.var.inertia.location()`
- [Flash data](/guide/flash-messages) with `c.var.inertia.flash()`
- [History encryption](/guide/history-encryption) with `encryptHistory()`
- History clearing with `clearHistory()`, which also works when the handler redirects
- [Server-side rendering](/guide/ssr) in the same process or through an Inertia SSR server, with a fallback to client rendering reported to `onSsrError`
- [BigInt props](/guide/rendering#bigint-props) with `preserveBigIntegers`
- [Server-provided head elements](/guide/view-data#server-provided-head-elements) with the `head` prop
- [View data](/guide/view-data#view-data) for the root template that stays out of the page object, with `viewData()`
- [DevTools protocol](/guide/devtools) with the `devtools` option
- `Cache-Control` on adapter responses with the [`cacheControl`](/guide/security#caching) option
- [Testing helpers](/guide/testing) in `@brachkow/hono-inertia/testing`
