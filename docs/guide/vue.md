---
description: Set up a Hono app with Inertia and Vue, with SSR, typed page props, usePageProps() and forms
---

# Vue

This guide sets up a Hono app with `@inertiajs/vue3`, server-side rendering in the same process, and typed page props. The [Vue example](https://github.com/brachkow/hono-inertia/tree/main/examples/vue-node) is the complete app, and the [Vue on Workers example](https://github.com/brachkow/hono-inertia/tree/main/examples/vue-workers) runs the same pages on Cloudflare Workers.

## Install

```bash
pnpm add hono @brachkow/hono-inertia @hono/node-server @inertiajs/vue3 @inertiajs/core vue
pnpm add -D vite @vitejs/plugin-vue @inertiajs/vite @hono/vite-dev-server vue-tsc
```

## Vite config

`honoInertia()` hands the server the asset tags, the version and the SSR entry, and writes `src/pages.gen.ts` with the page types. Pass `ssr: false` to `@inertiajs/vite`, because the Hono server renders pages itself:

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
      pages: {
        directory: 'src/pages',
        server: 'src/server.ts',
        sharedPageProps: true,
      },
    }),
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

The [SSR guide](/guide/ssr#_4-build-and-run) has `src/main.ts`, the production server, and the config for Cloudflare Workers.

## Server

Chain the routes on the app, so its type records the props each page gets:

```ts
// src/server.ts
import { Hono } from 'hono';
import { inertia } from '@brachkow/hono-inertia';
import * as assets from 'virtual:hono-inertia/assets';

const app = new Hono()
  .use(inertia({ assets, share: () => ({ appName: 'My app' }) }))
  .get('/', (c) => c.var.inertia.render('Home', { framework: 'Vue' }));

export default app;
```

Add `/// <reference types="@brachkow/hono-inertia/vite-plugin/client" />` to a `.d.ts` file to type the `virtual:hono-inertia/assets` import.

## Client entry

```ts
// src/client.ts
import { createInertiaApp } from '@inertiajs/vue3';
import Layout from './Layout.vue';

await createInertiaApp({
  pages: './pages',
  layout: () => Layout,
});
```

## SSR entry

The SSR entry renders a page object to `{ head, body }`. The plugin's `ssr` option hands it to `inertia({ assets })`. It resolves pages with `import.meta.glob`, because on Workers the `pages` shorthand in an SSR entry loads `@inertiajs/vue3` twice in dev:

```ts
// src/ssr.ts
import { createInertiaApp } from '@inertiajs/vue3';
import type { Page } from '@inertiajs/core';
import type { PageObject, SsrRenderResult } from '@brachkow/hono-inertia';
import { createSSRApp, h } from 'vue';
import type { DefineComponent } from 'vue';
import { renderToString } from 'vue/server-renderer';
import Layout from './Layout.vue';

const pages = import.meta.glob<DefineComponent>('./pages/**/*.vue', {
  import: 'default',
});

const renderPage = (page: PageObject): Promise<SsrRenderResult> =>
  createInertiaApp({
    // Inertia's Page type also requires client-only state that no server sends
    page: page as Page,
    render: renderToString,
    resolve: (name) => pages[`./pages/${name}.vue`](),
    layout: () => Layout,
    setup: ({ App, props, plugin }) =>
      createSSRApp({ render: () => h(App, props) }).use(plugin),
  });

export default renderPage;
```

## Pages and typed props

Vue's compiler reads the prop names from the type in `defineProps<T>()`, and it can't follow `PageProps`. A page has two ways to get typed props.

**`usePageProps()`** reads them from the current page, with no names to write out. Read them as `page.framework`: a destructured prop keeps the first page's value.

```vue
<!-- src/pages/Home.vue -->
<script setup lang="ts">
  import { usePageProps } from '@brachkow/hono-inertia/vue';

  const page = usePageProps<'Home'>();
</script>

<template>
  <h1>Hello from {{ page.framework }} in {{ page.appName }}</h1>
</template>
```

**`defineProps`** with each name written out and its type taken from `PageProps`. The generated file then checks that the page declares every prop its routes send:

```vue
<!-- src/pages/Users/Index.vue -->
<script setup lang="ts">
  import { Deferred, router } from '@inertiajs/vue3';
  import type { PageProps } from '../../pages.gen';

  type Properties = PageProps<'Users/Index'>;

  defineProps<{
    users: Properties['users'];
    stats?: Properties['stats'];
    activity?: Properties['activity'];
  }>();

  const loadStats = () => router.reload({ only: ['stats'] });
</script>

<template>
  <ul>
    <li v-for="user in users" :key="user.id">{{ user.name }}</li>
  </ul>
  <button type="button" @click="loadStats">Load stats</button>
  <p v-if="stats">{{ stats.total }} users in total</p>
  <Deferred data="activity">
    <template #fallback><p>Loading activity…</p></template>
    <ul>
      <li v-for="entry in activity" :key="entry">{{ entry }}</li>
    </ul>
  </Deferred>
</template>
```

The [TypeScript guide](/guide/typescript#typed-page-props) lists how the two differ. To render a `usePageProps()` page with other data, as in a story or a component test, wrap it in `<PagePropsProvider page="Home" :props="fixture">`.

## Layout and shared props

With `sharedPageProps: true`, the generated file types `usePage().props` with what `share` returns:

```vue
<!-- src/Layout.vue -->
<script setup lang="ts">
  import { Link, usePage } from '@inertiajs/vue3';

  const page = usePage();
</script>

<template>
  <header>
    <strong>{{ page.props.appName }}</strong>
    <nav>
      <Link href="/">Home</Link>
      <Link href="/users">Users</Link>
    </nav>
  </header>
  <main><slot /></main>
</template>
```

## Forms

`inertiaValidator()` on the route checks the form with a Standard Schema, and `withPrecognition()` lets the form check a field while the user types (see [Validation](/guide/validation)):

```vue
<!-- src/pages/Contact.vue -->
<script setup lang="ts">
  import { useForm } from '@inertiajs/vue3';

  const form = useForm({ name: '', email: '' }).withPrecognition(
    'post',
    '/contact',
  );
</script>

<template>
  <form @submit.prevent="form.post('/contact')">
    <input v-model="form.email" @blur="form.validate('email')" />
    <p v-if="form.errors.email">{{ form.errors.email }}</p>
    <button type="submit" :disabled="form.processing">Send</button>
  </form>
</template>
```
