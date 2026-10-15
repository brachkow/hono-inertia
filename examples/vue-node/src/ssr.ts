import { createInertiaApp } from '@inertiajs/vue3';
import createServer from '@inertiajs/vue3/server';
import type { Page } from '@inertiajs/core';
import { createSSRApp, h } from 'vue';
import type { DefineComponent } from 'vue';
import { renderToString } from 'vue/server-renderer';
import Layout from './Layout.vue';

// Must match SSR_URL in src/server.ts
const SSR_PORT = 13_716;

const pages = import.meta.glob<DefineComponent>('./pages/**/*.vue', {
  import: 'default',
});

const renderPage = (page: Page) =>
  createInertiaApp({
    page,
    render: renderToString,
    resolve: (name) => pages[`./pages/${name}.vue`](),
    layout: () => Layout,
    setup: ({ App, props, plugin }) =>
      createSSRApp({ render: () => h(App, props) }).use(plugin),
  });

// Production runs this file as Inertia's SSR server (`pnpm start:ssr`). In dev,
// src/server.ts imports renderPage and renders in-process instead.
if (import.meta.env.PROD) {
  createServer(renderPage, { port: SSR_PORT });
}

export default renderPage;
