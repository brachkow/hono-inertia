---
description: Server-side rendering on Node.js and Cloudflare Workers
---

# SSR

The adapter server-renders initial visits. It never server-renders Inertia requests, which are in-app navigations. The built-in template puts the SSR head and body in the page. A custom `render` function receives the result as `ssr`, with `ssr.head` already joined into one string. When SSR fails, `ssr` is `undefined` and the page renders client-side.

The setup below is the same on Node.js and Cloudflare Workers. The plugin's `ssr` option hands your SSR entry to `inertia({ assets })`, so pages render in the server's own process, with no second process to run or deploy. The adapter also supports [an Inertia SSR server](/guide/ssr#with-an-inertia-ssr-server) in a separate process.

## Setup

The steps use Vue. With React, the SSR entry calls `renderToString` from `react-dom/server` instead, as in the [React example](https://github.com/brachkow/hono-inertia/tree/main/examples/react-node).

```bash
pnpm add vue @inertiajs/vue3 @inertiajs/core
pnpm add -D vite @vitejs/plugin-vue @inertiajs/vite
```

### 1. Add the Vite plugin

`honoInertia()` gives the server the client's asset tags and version through `virtual:hono-inertia/assets`. The server inlines those tags, so the plugin builds the client before the server. Vite builds the server too, which lets it import `.vue` files. Pass `ssr: false` to `@inertiajs/vite`, since the server renders pages itself. Without it, `vite dev` also loads `src/ssr.ts` for Inertia's own SSR endpoint, and an SSR entry that calls `createInertiaApp()` at the top level gets wrapped in code that starts Inertia's SSR server. `honoInertia()` fails the build if that server ends up in the server bundle.

The rest of the config depends on the runtime.

**Node.js.** `@hono/vite-dev-server` runs the app inside Vite in dev. `builder: {}` makes `vite build` build every environment, the client and the server's `ssr` environment:

```bash
pnpm add @hono/node-server
pnpm add -D @hono/vite-dev-server
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import inertia from '@inertiajs/vite';
import devServer from '@hono/vite-dev-server';
import { honoInertia } from '@brachkow/hono-inertia/vite-plugin';

export default defineConfig({
  plugins: [
    vue(),
    inertia({ ssr: false }),
    honoInertia({ entry: 'src/client.ts', ssr: 'src/ssr.ts' }),
    // assetTags already holds /@vite/client in dev
    devServer({ entry: 'src/server.ts', injectClientScript: false }),
  ],
  builder: {},
  build: { outDir: 'dist/client' },
  environments: {
    ssr: {
      build: { outDir: 'dist/server', rollupOptions: { input: 'src/main.ts' } },
    },
  },
});
```

**Cloudflare Workers.** `@cloudflare/vite-plugin` runs the Worker in workerd during `vite dev` and builds it with Vite:

```bash
pnpm add -D @cloudflare/vite-plugin wrangler
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import inertia from '@inertiajs/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { honoInertia } from '@brachkow/hono-inertia/vite-plugin';

export default defineConfig({
  plugins: [
    vue(),
    inertia({ ssr: false }),
    honoInertia({ entry: 'src/client.ts', ssr: 'src/ssr.ts' }),
    cloudflare(),
  ],
});
```

### 2. Write the SSR entry

`src/ssr.ts` renders a page object to `{ head: string[], body: string }`, the same result an Inertia SSR entry returns. It resolves pages with `import.meta.glob` instead of the `pages` shorthand. On Workers, when the Worker transforms an entry that uses `pages`, `@inertiajs/vite` warms up the page files for the browser before Vite has pre-bundled the client's dependencies, and the browser loads two copies of `@inertiajs/vue3` in dev. The `pages` shorthand is fine in `src/client.ts`.

```ts
// src/ssr.ts
import { createInertiaApp } from '@inertiajs/vue3';
import type { Page } from '@inertiajs/core';
import type { PageObject } from '@brachkow/hono-inertia';
import { createSSRApp, h } from 'vue';
import type { DefineComponent } from 'vue';
import { renderToString } from 'vue/server-renderer';

const pages = import.meta.glob<DefineComponent>('./pages/*.vue', {
  import: 'default',
});

export default (page: PageObject) =>
  createInertiaApp({
    // Inertia's Page type also requires client-only state (rememberedState) that no server sends
    page: page as Page,
    render: renderToString,
    resolve: (name) => pages[`./pages/${name}.vue`](),
    setup: ({ App, props, plugin }) =>
      createSSRApp({ render: () => h(App, props) }).use(plugin),
  });
```

### 3. Pass the assets to the adapter

`assets` holds the SSR entry, the asset tags and the version, so the server needs nothing else:

```ts
// src/server.ts
import { Hono } from 'hono';
import { inertia } from '@brachkow/hono-inertia';
import * as assets from 'virtual:hono-inertia/assets';

const app = new Hono()
  .use(inertia({ assets }))
  .get('/', (c) => c.var.inertia.render('Home', { name: 'Hono' }));

export default app;
```

To render with another function, pass `ssr: { render }`, which wins over `assets.ssr`. To turn SSR off for some requests, pass `ssr.enabled` as a function of the context, or call `c.var.inertia.ssr(false)` in a handler:

```ts
app.get('/admin', (c) => {
  c.var.inertia.ssr(false);
  return c.var.inertia.render('Admin/Dashboard');
});
```

### 4. Build and run

**Node.js.** Vite builds the production server from a small entry that serves the app and the client assets with `@hono/node-server`:

```ts
// src/main.ts
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import app from './server';

const main = new Hono()
  .use('/assets/*', serveStatic({ root: './dist/client' }))
  .route('/', app);

serve({ fetch: main.fetch, port: Number(process.env.PORT ?? 3000) });
```

`vite dev` runs the app, `vite build` builds the client and then the server, and `node dist/server/main.js` starts it.

**Cloudflare Workers.** `wrangler.jsonc` points `main` at `src/server.ts`. `vite dev` runs the app, `vite build` builds the client and the Worker, and `wrangler deploy` deploys the output. The Cloudflare plugin builds the client a second time after the Worker, with the same file names, to move the files the Worker imports into the client's output.

## With an Inertia SSR server

An Inertia SSR server renders in a separate process, so a crash or memory leak in page rendering doesn't take the app down with it. This works with the Node server that `@inertiajs/vite` builds from your SSR entry (`createServer` from `@inertiajs/vue3/server`, `@inertiajs/react/server` or `@inertiajs/svelte/server`). Leave out `ssr: false` for it, and pass the server's URL:

```ts
inertia({
  ssr: {
    url: 'http://127.0.0.1:13714', // default
    timeout: 5000, // ms before falling back to client-side rendering (default 5000)
    maxResponseBytes: 2_000_000, // default
  },
});
```

Pass `fetch` to send the request another way, such as through a Cloudflare service binding: `fetch: (request, c) => c.env.SSR.fetch(request)`.

## When SSR fails

When SSR fails, the adapter calls `onSsrError(error, page)` and renders the page client-side. SSR fails when the SSR server is unreachable, times out, or returns an error or an invalid result, and when `ssr.render` throws. With an Inertia SSR server, `error.cause` holds the server's error details (`error`, `type`, `hint`, `stack`). The default handler logs with `console.error`. Throw from `onSsrError` to fail the request instead, which is useful in E2E tests:

```ts
inertia({
  assets,
  onSsrError: (error) => {
    throw error;
  },
});
```

A common cause is a component that touches a browser API (`window`, `document`, `localStorage`) during render. Wrap it in Inertia's `<WhenMounted>` (client 3.8+), which renders its `fallback` on the server and its children only after mounting in the browser.

The fallback looks the same to people, because the client renders the page after load. Crawlers get an empty `<div id="app"></div>`. Add a test that requests a page and checks the HTML for `data-server-rendered="true"`, so a broken SSR build fails CI instead of shipping.

## Module state is shared between requests

An in-process SSR entry stays loaded across requests in the same Node process or Workers isolate. Module-level state in client code, such as a store created at import time, carries over from one request to the next. Create request-scoped state inside components or `setup`, not at module level.
