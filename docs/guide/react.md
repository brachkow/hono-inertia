---
description: Set up a Hono app with Inertia and React, with SSR, typed page props and forms
---

# React

This guide sets up a Hono app with `@inertiajs/react`, server-side rendering in the same process, and typed page props. The [React example](https://github.com/brachkow/hono-inertia/tree/main/examples/react-node) is the complete app.

## Install

```bash
pnpm add hono @brachkow/hono-inertia @hono/node-server @inertiajs/react @inertiajs/core react react-dom
pnpm add -D vite @vitejs/plugin-react @inertiajs/vite @hono/vite-dev-server @types/react @types/react-dom
```

## Vite config

`honoInertia()` hands the server the asset tags, the version and the SSR entry, and writes `src/pages.gen.ts` with the page types. Pass `ssr: false` to `@inertiajs/vite`, because the Hono server renders pages itself:

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
    inertia({ ssr: false }),
    honoInertia({
      entry: 'src/client.tsx',
      ssr: 'src/ssr.tsx',
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
  .get('/', (c) => c.var.inertia.render('Home', { framework: 'React' }));

export default app;
```

Add `/// <reference types="@brachkow/hono-inertia/vite-plugin/client" />` to a `.d.ts` file to type the `virtual:hono-inertia/assets` import.

## Client entry

```tsx
// src/client.tsx
import { createInertiaApp } from '@inertiajs/react';
import { Layout } from './Layout';

await createInertiaApp({
  pages: './pages',
  layout: () => Layout,
});
```

## SSR entry

The SSR entry renders a page object to `{ head, body }`. The plugin's `ssr` option hands it to `inertia({ assets })`:

```tsx
// src/ssr.tsx
import { createInertiaApp } from '@inertiajs/react';
import type { Page } from '@inertiajs/core';
import type { PageObject, SsrRenderResult } from '@brachkow/hono-inertia';
import type { ComponentType } from 'react';
import { renderToString } from 'react-dom/server';
import { Layout } from './Layout';

const pages = import.meta.glob<ComponentType>('./pages/**/*.tsx', {
  import: 'default',
});

const renderPage = (page: PageObject): Promise<SsrRenderResult> =>
  createInertiaApp({
    // Inertia's Page type also requires client-only state that no server sends
    page: page as Page,
    render: renderToString,
    resolve: (name) => pages[`./pages/${name}.tsx`](),
    layout: () => Layout,
    setup: ({ App, props }) => <App {...props} />,
  });

export default renderPage;
```

## Pages and typed props

`PageProps<'Home'>` gives the props the routes send to `Home`, with shared props and `errors`:

```tsx
// src/pages/Home.tsx
import type { PageProps } from '../pages.gen';

const Home = ({ framework, appName }: PageProps<'Home'>) => (
  <h1>
    Hello from {framework} in {appName}
  </h1>
);

export default Home;
```

`optional()` and `deferred()` props are possibly `undefined`. Load them with `router.reload()` and Inertia's `<Deferred>`:

```tsx
import { Deferred, router } from '@inertiajs/react';
import type { PageProps } from '../../pages.gen';

const Index = ({ users, stats, activity }: PageProps<'Users/Index'>) => (
  <>
    <ul>
      {users.map((user) => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
    <button type="button" onClick={() => router.reload({ only: ['stats'] })}>
      Load stats
    </button>
    {stats && <p>{stats.total} users in total</p>}
    <Deferred data="activity" fallback={<p>Loading activity…</p>}>
      <ul>
        {activity?.map((entry) => (
          <li key={entry}>{entry}</li>
        ))}
      </ul>
    </Deferred>
  </>
);

export default Index;
```

## Layout and shared props

With `sharedPageProps: true`, the generated file types `usePage().props` with what `share` returns:

```tsx
// src/Layout.tsx
import { Link, usePage } from '@inertiajs/react';
import type { ReactNode } from 'react';

export const Layout = ({ children }: { children: ReactNode }) => {
  const page = usePage();

  return (
    <>
      <header>
        <strong>{page.props.appName}</strong>
        <nav>
          <Link href="/">Home</Link>
          <Link href="/users">Users</Link>
        </nav>
      </header>
      <main>{children}</main>
    </>
  );
};
```

## Forms

`inertiaValidator()` on the route checks the form with a Standard Schema, and `withPrecognition()` lets the form check a field while the user types (see [Validation](/guide/validation)):

```tsx
// src/pages/Contact.tsx
import { useForm } from '@inertiajs/react';
import type { FormEvent } from 'react';

const Contact = () => {
  const form = useForm({ name: '', email: '' }).withPrecognition(
    'post',
    '/contact',
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    form.post('/contact');
  };

  return (
    <form onSubmit={submit}>
      <input
        value={form.data.email}
        onChange={(event) => form.setData('email', event.target.value)}
        onBlur={() => form.validate('email')}
      />
      {form.errors.email && <p>{form.errors.email}</p>}
      <button type="submit" disabled={form.processing}>
        Send
      </button>
    </form>
  );
};

export default Contact;
```
