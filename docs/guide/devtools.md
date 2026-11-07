---
description: Record requests for the Inertia DevTools extension
---

# DevTools

The [Inertia DevTools](https://inertiajs.com/docs/devtools) browser extension records every request in its own panel: which props the server returned and how they were wrapped, request and response bodies, and timing. The adapter implements the server side of the [DevTools protocol](https://inertiajs.com/docs/devtools-protocol). Enable it in development only:

```ts
inertia({
  devtools: process.env.NODE_ENV !== 'production',
});
```

With it on, every response carries an `X-Inertia-Devtools-Id` header, the adapter injects a `<script data-inertia-devtools-id>` tag before `</body>` in the initial HTML, and it serves entries from `GET /_inertia/devtools/entries/:id` (and `/_inertia/devtools/entries` with `component`, `type`, `exclude`, `offset` and `limit` filters). The client needs `dev: true` in `createInertiaApp()` for visit grouping.

Entries record the page object, the resolved prop values, the matched Hono route path, and request and response headers and bodies. Before storing an entry, the adapter replaces sensitive keys (`password`, `token`, `secret`, …) and headers (`cookie`, `authorization`, …) with `[REDACTED]`, and summarizes uploads as `{ name, size, mimeType }`. Recording never affects your response. If anything in it fails, the adapter drops the entry and returns your response unchanged.

Options, all optional:

```ts
import { createMemoryDevtoolsStore } from '@brachkow/hono-inertia';

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
});
```

The default store keeps entries in memory, per `inertia()` instance. This works for a local `node`, `bun` or `wrangler dev` server. A setup with multiple isolates or processes that must share entries can pass a `DevtoolsStore` (`set`, `get`, `all` newest first, sync or async) backed by KV, a Durable Object, or any other storage.

The adapter injects the initial-load tag by rewriting the HTML response, so your template needs a `</body>` and the body must not be streamed. Hono doesn't expose route names or handler source locations, so the panel's Route tab shows only the matched path.
