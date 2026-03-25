# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is this

Inertia.js v2 server-side adapter for Hono. Zero runtime dependencies (peer: `hono >=4.0.0`). ESM-only library.

## Commands

```bash
pnpm test          # run all tests (vitest, once)
pnpm test:watch    # vitest in watch mode
pnpm test -- tests/props.test.ts  # run a single test file
pnpm typecheck     # tsc --noEmit
pnpm build         # tsup → dist/
```

## Architecture

The library is a Hono middleware + prop helpers. Request flow:

1. **`inertia()` middleware** (`src/middleware.ts`) — factory that returns a Hono middleware. Resolves asset version, checks version conflicts (409), creates `InertiaResponse`, applies shared props, and post-handler converts 302→303 for PUT/PATCH/DELETE.

2. **`InertiaResponse`** (`src/response.ts`) — attached to Hono context as `c.get('inertia')`. Its `render(component, props)` method does the heavy lifting: classifies props by tag type, resolves partial/deferred/merge/once logic against Inertia request headers, resolves lazy functions in parallel, builds the `PageObject`, and returns either JSON (Inertia request) or HTML (initial visit, optionally via SSR).

3. **Prop wrappers** (`src/props.ts`) — `optional()`, `always()`, `deferred()`, `merge()`/`prepend()`/`deepMerge()`, `once()`. Each returns a tagged object (symbol `PROP_TYPE` from `src/symbols.ts`). Wrappers are chainable: e.g. `deferred(fn).merge().once()`.

4. **Utils** (`src/utils.ts`) — header parsing helpers for `X-Inertia`, `X-Inertia-Partial-Data`, `X-Inertia-Version`, etc.

5. **SSR** (`src/ssr.ts`) — dispatches page object to an external SSR server via HTTP POST.

Key type: `InertiaEnv` (`src/types.ts`) — Hono env binding that types `c.get('inertia')`.
