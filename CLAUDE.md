# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is this

Inertia.js v3 server-side adapter for Hono. Zero runtime dependencies (peer: `hono >=4.8.0 || >=5.0.0-rc.1`). ESM-only library.

A pnpm monorepo:

- `packages/hono-inertia/` is the published library. Paths below are relative to it.
- `examples/` holds runnable apps (`react-node`, `vue-node`, `svelte-node`, `vue-workers`) that double as guides. They implement the same pages and depend on the library via `workspace:*`, which resolves to its `dist/`, so build the library first.
- `e2e/` is one Playwright suite that runs against every example twice: the production build, and the Vite dev server (ports +1000), where `hmr.spec.ts` also edits a page and checks it updates without a reload.

## Goals

Weigh every change against these:

- Full, idiomatic support of Inertia, with the Laravel adapter as the reference
- JavaScript first: don't bring in PHP or Laravel conventions where they conflict with JavaScript ones
- Fewer decisions and less boilerplate: an app should work well with little or no configuration
- Still flexible, with options for projects that need something different

## Commands

Run from the repo root:

```bash
pnpm test          # library unit tests (vitest) against Hono 4, Hono 5, and the lowest supported Hono 4.8.0 with Vite 7.0.0
pnpm build         # build the library with tsdown → packages/hono-inertia/dist/
pnpm typecheck     # typecheck every package (build the library first); the library also against the lowest versions and Hono 5 (tsconfig.lowest.json, tsconfig.hono-5.json)
pnpm test:lint     # eslint (eslint-config-fans)
pnpm fix:lint      # eslint --fix
pnpm test:format   # prettier --check
pnpm fix:format    # prettier --write
pnpm size          # size-limit for the library
pnpm test:e2e      # build the library and examples, then run Playwright
pnpm fetch:inertia # clone upstream Inertia into .inertia/ (gitignored, for reference)
```

Run a single unit test file with `pnpm --filter @brachkow/hono-inertia exec vitest run tests/properties.test.ts`. Limit e2e to some examples with `E2E_EXAMPLES=vue-node pnpm --filter e2e test`.

## Architecture

The library is a Hono middleware + prop helpers. Request flow:

1. **`inertia()` middleware** (`src/middleware.ts`) — factory that returns a Hono middleware. Resolves asset version, checks version conflicts (409), creates `InertiaResponse`, applies shared props, and post-handler redirects an empty 200 back, turns redirects to a URL with `#` into a 409 `X-Inertia-Redirect`, converts 302→303 for PUT/PATCH/DELETE/QUERY, and writes the session.

2. **`InertiaResponse`** (`src/response.ts`) — attached to Hono context as `c.get('inertia')`. Its `render(component, props)` method does the heavy lifting: classifies props by tag type, resolves partial/deferred/merge/once logic against Inertia request headers, resolves lazy functions in parallel, builds the `PageObject`, and returns either JSON (Inertia request) or HTML (initial visit, optionally via SSR).

3. **Prop wrappers** (`src/properties.ts`) — `optional()`, `always()`, `deferred()`, `merge()`/`prepend()`/`deepMerge()`, `once()`. Each returns a tagged object (symbol `PROP_TYPE` from `src/symbols.ts`). Wrappers are chainable: e.g. `deferred(fn).merge().once()`.

4. **Utils** (`src/utilities.ts`) — header parsing helpers for `X-Inertia`, `X-Inertia-Partial-Data`, `X-Inertia-Version`, etc.

5. **SSR** (`src/ssr.ts`) — renders the page object via an external SSR server (HTTP POST to `ssr.url`) or an in-process `ssr.render` function, validates the `{ head, body }` result, and rejects on failure. `InertiaResponse.render` catches the rejection, reports it via `onSsrError`, and falls back to CSR.

6. **Typed page props** (`src/page-properties.ts`), types only. `render()` returns a `TypedResponse` recording the component and its resolved props, and the middleware records `share()`'s type in the app's Env. `PageProps<C>` reads both from the app registered in `AppRegistry`. The Vite plugin's `pages` option writes the `*.gen.ts` file that fills `AppRegistry` and `InertiaPages`, and checks with `VuePage` that every `.vue` page declares the props its routes pass. `tests/page-properties.test.ts` holds the type assertions; `pnpm typecheck` checks them.

7. **Session** (`src/session.ts`) — the `session` option (`InertiaSession`: `get` reads without clearing, `set(c, null)` clears) carries `withErrors()` errors and `flash()` data across redirects. `InertiaResponse.sessionAfter` decides what to write: a rendered page clears it, anything else keeps it and adds what the handler set. `cookieSession()` is the built-in signed-cookie store.

8. **Validator** (`src/validator.ts`) — `inertiaValidator(target, schema)` wraps `hono/validator` with a Standard Schema: precognition requests get 204/422 without running the handler, failed submits go back with errors in the session.

9. **Testing helpers** (`src/testing.ts`) — the `./testing` entry: `inertiaRequest()`, `inertiaHeaders()`, `getPage()`.

10. **Vue helper** (`src/vue.ts`) — the `./vue` entry: `usePageProps()`, a read-only proxy over `usePage().props` typed with `PageProps`. `@inertiajs/vue3` is an optional peer. The pages file leaves Vue pages that use it out of the `VuePage` check.

Key type: `InertiaEnv` (`src/types.ts`) — Hono env binding that types `c.get('inertia')`.

## Reference

Consult the upstream Inertia.js project to match its protocol and client behavior:

- Docs: https://inertiajs.com/
- Changelog (releases): https://github.com/inertiajs/inertia/releases
- Local source snapshot: run `pnpm fetch:inertia` to clone the Inertia repo into `.inertia/` (gitignored). `.inertia/packages/core` is the client core this server adapter must mirror (data-page boot, X-Inertia headers, partial reloads, deferred/merge props, history encryption).
