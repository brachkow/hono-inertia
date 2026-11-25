---
description: What honoInertia() does, why a Hono server needs it, and how it works next to @inertiajs/vite
---

# Vite plugin

A hono-inertia app usually runs two Vite plugins:

- `@inertiajs/vite` is Inertia's own plugin. It transforms the code that calls `createInertiaApp()`.
- `honoInertia()` from `@brachkow/hono-inertia/vite-plugin` connects the client build to the Hono server.

They do different jobs, and neither replaces the other.

## Why the server needs a plugin

An Inertia server sends an HTML page on the first visit. That page has to load the client, so the server needs to know what Vite built:

- the hashed file name of the client entry, its stylesheets and the chunks to preload
- other tags under `vite dev`, such as `/@vite/client` and the React Refresh preamble
- a version that changes when those files change, for [asset versioning](/guide/assets)
- the SSR entry, to render pages on the server

In Laravel, other packages cover this. `laravel-vite-plugin` and the `@vite` Blade directive read the manifest and print the tags, and the Laravel adapter hashes `public/build/manifest.json` for the version. `@inertiajs/vite` doesn't do any of it, because it expects the backend to.

Hono has no such piece. A server could read `.vite/manifest.json` at runtime and build the tags itself, but Cloudflare Workers has no file system, and `vite dev` writes no manifest. `honoInertia()` does the work at build time and gives the server the results as a module:

```ts
// src/server.ts
import * as assets from 'virtual:hono-inertia/assets';

app.use(inertia({ assets }));
```

The module holds strings and one function, so it runs on Node.js, Workers, Bun and Deno.

## What each plugin does

| Job                                                                            | `@inertiajs/vite`                 | `honoInertia()` |
| ------------------------------------------------------------------------------ | --------------------------------- | --------------- |
| Turn `pages: './pages'` in `createInertiaApp()` into a resolver                | Yes                               | No              |
| Warm up the page files in dev                                                  | Yes                               | No              |
| Serve an SSR endpoint in dev (`/__inertia_ssr`) and build Inertia's SSR server | Yes, unless you pass `ssr: false` | No              |
| Give the server the script, stylesheet and preload tags                        | No                                | Yes             |
| Give the server the asset version                                              | No                                | Yes             |
| Give the server the SSR entry, to render in its own process                    | No                                | Yes             |
| Preload the chunks of the page being rendered                                  | No                                | Yes             |
| Write `pages.gen.ts` with the page prop types                                  | No                                | Yes             |
| Build the client before the server                                             | No                                | Yes             |
| Move the client manifest out of the public output                              | No                                | Yes             |

## Using both

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
    honoInertia({
      entry: 'src/client.ts',
      ssr: 'src/ssr.ts',
      pages: { directory: 'src/pages', server: 'src/server.ts' },
    }),
    devServer({ entry: 'src/server.ts', injectClientScript: false }),
  ],
});
```

Pass `ssr: false` to `@inertiajs/vite` when the Hono server renders pages itself. Without it, `@inertiajs/vite` also loads the SSR entry for its own dev endpoint. It also wraps an SSR entry that calls `createInertiaApp()` at the top level in code that starts Inertia's SSR server. `honoInertia()` fails the build when that server ends up in the server bundle, because it would start on import and hold a port.

Two option names appear in both plugins and mean different things:

| Name    | In `@inertiajs/vite`                                                                 | In `honoInertia()`                                                                                                           |
| ------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `pages` | An option of `createInertiaApp()` in the client. The plugin turns it into a resolver | The folder and server module that `pages.gen.ts` is written from, for [typed page props](/guide/typescript#typed-page-props) |
| `ssr`   | Settings of Inertia's SSR server, or `false` to turn it off                          | The path of the SSR entry that the Hono server renders with (see [SSR](/guide/ssr))                                          |

Both `pages` settings point at the same folder. One loads the components in the browser, the other types them.

## Without `@inertiajs/vite`

`honoInertia()` doesn't depend on `@inertiajs/vite`. Without it, write the resolver that the `pages` shorthand stands for:

```ts
// src/client.ts
const pages = import.meta.glob('./pages/**/*.vue');

await createInertiaApp({
  resolve: (name) => pages[`./pages/${name}.vue`](),
});
```

## With Inertia's SSR server

To render in a separate process, leave out `ssr: false` and the `ssr` option of `honoInertia()`, and point the adapter at the server that `@inertiajs/vite` builds. `honoInertia()` still provides the asset tags and the version. See [With an Inertia SSR server](/guide/ssr#with-an-inertia-ssr-server).

## Without `honoInertia()`

The adapter works without the plugin. You then pass `version` and a `render` function that writes the tags. See [Without the plugin](/guide/assets#without-the-plugin).

## Requirements

- Vite 7 or newer
- Vite has to run the server in dev and build it for production, because `virtual:hono-inertia/assets` only exists inside Vite. `@hono/vite-dev-server` and `@cloudflare/vite-plugin` both run the server inside `vite dev`.

## Reference

- [Asset versioning](/guide/assets#vite-plugin) covers `entry`, `versionSalt`, `pageSource` and the exports of `virtual:hono-inertia/assets`
- [SSR](/guide/ssr) covers the `ssr` option
- [TypeScript](/guide/typescript#typed-page-props) covers the `pages` option
