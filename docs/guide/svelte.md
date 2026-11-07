---
description: Set up a Hono app with Inertia and Svelte 5, with SSR, typed page props and forms
---

# Svelte

This guide sets up a Hono app with `@inertiajs/svelte` and Svelte 5, server-side rendering in the same process, and typed page props. The [Svelte example](https://github.com/brachkow/hono-inertia/tree/main/examples/svelte-node) is the complete app.

## Install

```bash
pnpm add hono @brachkow/hono-inertia @hono/node-server @inertiajs/svelte @inertiajs/core svelte
pnpm add -D vite @sveltejs/vite-plugin-svelte @inertiajs/vite @hono/vite-dev-server svelte-check
```

## Vite config

`honoInertia()` hands the server the asset tags, the version and the SSR entry, and writes `src/pages.gen.ts` with the page types. Pass `ssr: false` to `@inertiajs/vite`, because the Hono server renders pages itself:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import inertia from '@inertiajs/vite';
import devServer from '@hono/vite-dev-server';
import { honoInertia } from '@brachkow/hono-inertia/vite-plugin';

export default defineConfig({
  plugins: [
    svelte(),
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

The [SSR guide](/guide/ssr#_4-build-and-run) has `src/main.ts`, the production server.

## Server

Chain the routes on the app, so its type records the props each page gets:

```ts
// src/server.ts
import { Hono } from 'hono';
import { inertia } from '@brachkow/hono-inertia';
import * as assets from 'virtual:hono-inertia/assets';

const app = new Hono()
  .use(inertia({ assets, share: () => ({ appName: 'My app' }) }))
  .get('/', (c) => c.var.inertia.render('Home', { framework: 'Svelte' }));

export default app;
```

Add `/// <reference types="@brachkow/hono-inertia/vite-plugin/client" />` to a `.d.ts` file to type the `virtual:hono-inertia/assets` import.

## Client entry

```ts
// src/client.ts
import { createInertiaApp } from '@inertiajs/svelte';
import Layout from './Layout.svelte';

await createInertiaApp({
  pages: './pages',
  layout: () => Layout,
});
```

## SSR entry

The SSR entry renders a page object to `{ head, body }`. The plugin's `ssr` option hands it to `inertia({ assets })`. Svelte's resolver takes the whole module, so the glob has no `import: 'default'`:

```ts
// src/ssr.ts
import { createInertiaApp } from '@inertiajs/svelte';
import type { ResolvedComponent } from '@inertiajs/svelte';
import type { Page } from '@inertiajs/core';
import type { PageObject, SsrRenderResult } from '@brachkow/hono-inertia';
import { render } from 'svelte/server';
import Layout from './Layout.svelte';

const pages = import.meta.glob<ResolvedComponent>('./pages/**/*.svelte');

const renderPage = async (page: PageObject): Promise<SsrRenderResult> => {
  const result = await createInertiaApp({
    // Inertia's Page type also requires client-only state that no server sends
    page: page as Page,
    resolve: (name) => pages[`./pages/${name}.svelte`](),
    layout: () => Layout,
    setup: ({ App, props }) => render(App, { props }),
  });
  // Its type also covers the browser, where it returns nothing
  if (!result) throw new Error('createInertiaApp rendered nothing');
  return result;
};

export default renderPage;
```

## Pages and typed props

Annotate `$props()` with `PageProps<'Home'>`, which gives the props the routes send to `Home`, with shared props and `errors`:

```svelte
<!-- src/pages/Home.svelte -->
<script lang="ts">
  import type { PageProps } from '../pages.gen';

  const { framework, appName }: PageProps<'Home'> = $props();
</script>

<h1>Hello from {framework} in {appName}</h1>
```

`optional()` and `deferred()` props are possibly `undefined`. Load them with `router.reload()` and Inertia's `<Deferred>`:

```svelte
<script lang="ts">
  import { Deferred, router } from '@inertiajs/svelte';
  import type { PageProps } from '../../pages.gen';

  const { users, stats, activity }: PageProps<'Users/Index'> = $props();
</script>

<ul>
  {#each users as user (user.id)}
    <li>{user.name}</li>
  {/each}
</ul>
<button type="button" onclick={() => router.reload({ only: ['stats'] })}>
  Load stats
</button>
{#if stats}
  <p>{stats.total} users in total</p>
{/if}
<Deferred data="activity">
  {#snippet fallback()}
    <p>Loading activity…</p>
  {/snippet}
  <ul>
    {#each activity ?? [] as entry (entry)}
      <li>{entry}</li>
    {/each}
  </ul>
</Deferred>
```

## Layout and shared props

With `sharedPageProps: true`, the generated file types `usePage().props` with what `share` returns:

```svelte
<!-- src/Layout.svelte -->
<script lang="ts">
  import { Link, usePage } from '@inertiajs/svelte';
  import type { Snippet } from 'svelte';

  const { children }: { children: Snippet } = $props();

  const page = usePage();
</script>

<header>
  <strong>{page.props.appName}</strong>
  <nav>
    <Link href="/">Home</Link>
    <Link href="/users">Users</Link>
  </nav>
</header>
<main>
  {@render children()}
</main>
```

## Forms

`inertiaValidator()` on the route checks the form with a Standard Schema, and `withPrecognition()` lets the form check a field while the user types (see [Validation](/guide/validation)):

```svelte
<!-- src/pages/Contact.svelte -->
<script lang="ts">
  import { useForm } from '@inertiajs/svelte';

  const form = useForm({ name: '', email: '' }).withPrecognition(
    'post',
    '/contact',
  );
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    form.post('/contact');
  };
</script>

<form onsubmit={submit}>
  <input bind:value={form.email} onblur={() => form.validate('email')} />
  {#if form.errors.email}
    <p>{form.errors.email}</p>
  {/if}
  <button type="submit" disabled={form.processing}>Send</button>
</form>
```
