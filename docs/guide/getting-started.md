---
description: Install the adapter and render a first Inertia page from a Hono app with Vite
---

# Getting started

## Requirements

- Hono 4.8.0 or a later 4.x, or Hono 5
- An Inertia v3 client: `@inertiajs/vue3`, `@inertiajs/react` or `@inertiajs/svelte`. BigInt props need client 3.8 or newer, and server-provided head elements need 3.5 or newer
- Node.js 22.12 or newer when running on Node.js. On Cloudflare Workers, no Node.js compatibility flag is needed
- Vite 7 or newer, only for the optional Vite plugin
- ESM. The package has no CommonJS build

## Install

```bash
pnpm add @brachkow/hono-inertia
```

## Quick start

A React app that Vite runs in dev. The [React](/guide/react), [Vue](/guide/vue) and [Svelte](/guide/svelte) guides set up each framework with server-side rendering, typed pages and forms, and the [examples](#examples) are complete apps.

```bash
pnpm add hono @brachkow/hono-inertia @inertiajs/react react react-dom
pnpm add -D vite @vitejs/plugin-react @inertiajs/vite @hono/vite-dev-server
```

`honoInertia()` gives the server the client's script tags and the asset version through `virtual:hono-inertia/assets`, and writes `src/pages.gen.ts`, which types each page's props:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import inertia from '@inertiajs/vite';
import devServer from '@hono/vite-dev-server';
import { honoInertia } from '@brachkow/hono-inertia/vite-plugin';

export default defineConfig({
  plugins: [
    react(),
    inertia(),
    honoInertia({
      entry: 'src/client.tsx',
      pages: { directory: 'src/pages', server: 'src/server.ts' },
    }),
    // assetTags already holds /@vite/client in dev
    devServer({ entry: 'src/server.ts', injectClientScript: false }),
  ],
});
```

The routes are chained, so the app's type records the props each page gets:

```ts
// src/server.ts
import { Hono } from 'hono';
import { inertia } from '@brachkow/hono-inertia';
import * as assets from 'virtual:hono-inertia/assets';

const app = new Hono()
  .use(inertia({ assets }))
  .get('/', (c) => c.var.inertia.render('Home', { title: 'Hello' }));

export default app;
```

`assets` gives `inertia()` the version and the script tags, and `inertia()` renders the HTML page with its [built-in template](/guide/configuration#root-template).

```tsx
// src/client.tsx
import { createInertiaApp } from '@inertiajs/react';

await createInertiaApp({ pages: './pages' });
```

```tsx
// src/pages/Home.tsx
import type { PageProps } from '../pages.gen';

const Home = ({ title }: PageProps<'Home'>) => <h1>{title}</h1>;

export default Home;
```

Add `/// <reference types="@brachkow/hono-inertia/vite-plugin/client" />` to a `.d.ts` file to type the `virtual:hono-inertia/assets` import. `vite dev` then serves the app.

## Examples

Complete apps with Vite, server-side rendering and production builds:

- [React on Node.js](https://github.com/brachkow/hono-inertia/tree/main/examples/react-node) renders pages inside the Node server
- [Vue on Node.js](https://github.com/brachkow/hono-inertia/tree/main/examples/vue-node) has the same setup with Vue
- [Svelte on Node.js](https://github.com/brachkow/hono-inertia/tree/main/examples/svelte-node) has the same setup with Svelte 5
- [Vue on Cloudflare Workers](https://github.com/brachkow/hono-inertia/tree/main/examples/vue-workers) renders pages inside the Worker

Each example has the same pages: navigation, shared props, partial reloads, deferred and merge props, a form validated with `inertiaValidator()` and precognition, and a flash message after a redirect through the cookie session. One Playwright suite runs against all of them in CI.

## Differences from `@hono/inertia`

You may be wondering why this package exists when Hono has a first-party adapter, [`@hono/inertia`](https://www.npmjs.com/package/@hono/inertia).

- It has limited coverage of Inertia.js features, both new and old
- It doesn't take care of SSR for you
- It is still unstable, and its development, for obvious reasons, doesn't seem to be a top priority
