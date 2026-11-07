---
description: Typed page props, shared props and the Vue helpers
---

# TypeScript

## Typed page props

The Vite plugin can write a file that ties each page component to the routes that render it. Page components then get their props' types from those routes, and `render()` rejects a page name that has no file.

1. Point the plugin at the pages folder and the module that exports the app:

   ```ts
   honoInertia({
     entry: 'src/client.ts',
     pages: { directory: 'src/pages', server: 'src/server.ts' },
   });
   ```

   It writes `src/pages.gen.ts` when Vite starts, and again when a page is added or deleted. Commit the file, so `tsc` works before Vite has run.

2. Chain the middleware and routes on the app. Hono records a route's types only in the type of the chained expression:

   ```ts
   const app = new Hono()
     .use(inertia({ render, share: () => ({ appName: 'Demo' }) }))
     .get('/users', (c) =>
       c.var.inertia.render('Users/Index', {
         users: merge(() => db.users.page(1)),
         stats: optional(() => db.users.stats()),
       }),
     );

   export default app;
   ```

3. Read the props in the page with `PageProps`:

   ```tsx
   import type { PageProps } from '../pages.gen';

   const Index = ({ users, stats, appName }: PageProps<'Users/Index'>) => {
     // users: User[], stats?: Stats, appName: string, errors
   };
   ```

`PageProps` resolves lazy functions and prop wrappers to their values. `optional()` and `deferred()` props are optional, because the first visit leaves them out. Props from a typed `share()` and the `errors` prop are included. When several routes, or several `render()` calls in one handler, render the same page with different props, a prop that only some of them send is possibly `undefined`.

The types describe the props as the client receives them, after JSON. A `Date`, or anything else with `toJSON()`, has the type that `toJSON()` returns, so a `Date` is a `string`. Inside objects, fields that are functions or symbols are left out, and a field that may be `undefined` is optional. In arrays, those values are `null`. `Map` and `Set` arrive as empty objects. A `bigint` stays a `bigint`, because the client (3.8+) turns it back into one.

In Svelte 5, annotate `$props()` the same way:

```svelte
<script lang="ts">
  import type { PageProps } from '../pages.gen';

  const { users, stats }: PageProps<'Users/Index'> = $props();
</script>
```

Vue's `defineProps<T>()` can't take `PageProps` directly, because the SFC compiler has to read the prop names from `T`, and it can't resolve a type computed from the routes. So in Vue pages the prop names stay manual: write them out and take each type from `PageProps`. `vue-tsc` then fails when a route stops sending a prop:

```vue
<script setup lang="ts">
  import type { PageProps } from '../pages.gen';

  type Properties = PageProps<'Users/Index'>;

  defineProps<{
    users: Properties['users'];
    stats?: Properties['stats'];
  }>();
</script>
```

The generated file also checks each `.vue` page the other way. When a route sends a prop the page doesn't declare, `vue-tsc` fails in the generated file and names the prop (`'Missing props': "total"`). Shared props and `errors` are left out of that check, because a page declares them only if it reads them.

To skip the prop names, a Vue page can read its props from the current page with `usePageProps()` from `@brachkow/hono-inertia/vue`. It needs `@inertiajs/vue3`, and it works during SSR:

```vue
<script setup lang="ts">
  import { usePageProps } from '@brachkow/hono-inertia/vue';

  const page = usePageProps<'Users/Index'>();
</script>

<template>
  <p v-for="user in page.users" :key="user.id">{{ user.name }}</p>
</template>
```

`page` has the type `PageProps<'Users/Index'>`, shared props and `errors` included. It reads `usePage().props` on every access, so it updates after each visit and reload. A variable that holds `usePage().props` keeps the first page's props, because Inertia puts a new object there on each visit. A page that calls `usePageProps()` in `<script setup>` and has no `defineProps` is left out of the generated check, and the file lists it in a comment. It stays in `InertiaPages`, so `render()` still takes its name.

Compared with `defineProps`, a page that uses `usePageProps()` behaves differently:

- Read the props as `page.users`. `const { users } = usePageProps()` copies the values once and doesn't update after `router.reload()` or a partial reload. No type or lint check catches it.
- It always shows the current page. As soon as a visit lands, it has the next page's props, for example while an exit transition plays or in `onBeforeUnmount`. `defineProps` keeps the props the component was rendered with.
- There are no client-side defaults. Without `withDefaults`, a route has to send every prop, or the page handles `undefined`. A missing optional boolean is `undefined`, where Vue's `defineProps` gives `false`.
- The generated check is off for that page, so nothing reports a prop that routes send and the page never reads.
- To render the page with other data, as in a story or a component test, wrap it in `<PagePropsProvider>` (see below).

`<PagePropsProvider>` gives the pages inside it their own props, which `usePageProps()` reads instead of the current page. Several providers side by side render the same page with different data, or two pages with props that share keys. The props are typed as `PageProps<page>`, shared props and `errors` included:

```vue
<script setup lang="ts">
  import { PagePropsProvider } from '@brachkow/hono-inertia/vue';
  import Profile from './pages/Profile.vue';
</script>

<template>
  <PagePropsProvider page="Profile" :props="ada"><Profile /></PagePropsProvider>
  <PagePropsProvider page="Profile" :props="grace"
    ><Profile
  /></PagePropsProvider>
</template>
```

A component test mounts the page inside it, so it needs no mocked `usePage()` to reset between tests. `providePageProps<'Profile'>(props)` does the same from a parent's `setup`. Pass it a function to read reactive props on each access, as the component does with its `props`.

`RouteProps<'Users/Index'>` gives what the routes of a page send, without shared props and `errors`. It types fixtures for stories and tests against the routes:

```ts
import type { RouteProps } from '@brachkow/hono-inertia';

const props: RouteProps<'Users/Index'> = { users: [], stats: { total: 0 } };
```

The vue-node example's `Home` page uses `usePageProps()`, and its other pages use `defineProps`.

The [examples](/guide/getting-started#examples) use this setup. Options: `output` sets the file's path (default: the directory plus `.gen.ts`), `extensions` the page file extensions (default: `tsx`, `jsx`, `vue`, `svelte`), and `exclude` page names to leave out.

`export` names the export of `server` that holds the app, for a Workers entry whose default export is a handler object such as `{ fetch, scheduled }`. It defaults to `'default'`:

```ts
pages: { directory: 'src/pages', server: 'src/worker.ts', export: 'app' },
```

A page's name is its path in the folder without the extension. For another layout, pass `name`, which takes the path in the folder and returns the page name, or `null` for a file that is not a page. This one fits a folder per page, `Landing/Landing.vue`, with its components in `Landing/components/`:

```ts
pages: {
  directory: 'src/views',
  server: 'src/server.ts',
  name: (relativePath) => /^([^/]+)\/\1\.vue$/.exec(relativePath)?.[1] ?? null,
},
```

Two files with the same name fail the build.

The client reads shared props through `usePage()` and its own `sharedPageProps` type, which apps usually declare by hand. Pass `sharedPageProps: true` and the generated file declares it from what `share` and `inertiaShare()` return:

```ts
pages: { directory: 'src/pages', server: 'src/server.ts', sharedPageProps: true },
```

It augments `@inertiajs/core`, so the app needs `@inertiajs/core` as a direct dependency, and a hand-written `sharedPageProps` declaration has to go. `SharedProps<typeof app>` gives the same type for your own declarations.

When the server imports the SSR entry itself and passes it as `ssr.render`, give the entry an explicit return type. Otherwise TypeScript reports `'sharedPageProps' is referenced directly or indirectly in its own type annotation` and gives up on the app's type. The app holds the SSR function, the function's inferred type goes through `createInertiaApp()`, and that reads `sharedPageProps`, which comes from the app. With the plugin's `ssr` option, `assets.ssr` has a fixed type, so the loop doesn't happen:

```ts
import type { PageObject, SsrRenderResult } from '@brachkow/hono-inertia';

const renderPage = (page: PageObject): Promise<SsrRenderResult> =>
  createInertiaApp({/* ... */});
```

The [examples](/guide/getting-started#examples) turn `sharedPageProps` on and pass their SSR entries through the plugin's `ssr` option.

## Typing `c.var.inertia`

Chained apps get `c.var.inertia` typed from the middleware. For an app built with separate `app.get()` calls, use `InertiaEnv`:

```ts
import type { InertiaEnv } from '@brachkow/hono-inertia';

const app = new Hono<InertiaEnv>();
```

Compose with your own env types:

```ts
type AppEnv = InertiaEnv & {
  Variables: { db: Database };
};

const app = new Hono<AppEnv>();
```
