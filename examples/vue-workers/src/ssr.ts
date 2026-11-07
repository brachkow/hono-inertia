import { createInertiaApp } from '@inertiajs/vue3';
import type { Page } from '@inertiajs/core';
import type { SsrRenderResult } from '@brachkow/hono-inertia';
import { createSSRApp, h } from 'vue';
import type { DefineComponent } from 'vue';
import { renderToString } from 'vue/server-renderer';
import Layout from './Layout.vue';

// import.meta.glob rather than the `pages` shorthand: when the Worker
// transforms an entry that uses `pages`, @inertiajs/vite warms up the page
// files for the browser too early, and dev loads two copies of @inertiajs/vue3.
const pages = import.meta.glob<DefineComponent>('./pages/**/*.vue', {
  import: 'default',
});

// The Worker calls this for every page, in dev and in production
// The return type is written out. Inferring it goes through the types of
// createInertiaApp(), which read sharedPageProps from src/pages.gen.ts, and
// those come from the app that holds this function, so TypeScript would loop.
const renderPage = (page: Page): Promise<SsrRenderResult> =>
  createInertiaApp({
    page,
    render: renderToString,
    resolve: (name) => pages[`./pages/${name}.vue`](),
    layout: () => Layout,
    setup: ({ App, props, plugin }) =>
      createSSRApp({ render: () => h(App, props) }).use(plugin),
  });

export default renderPage;
