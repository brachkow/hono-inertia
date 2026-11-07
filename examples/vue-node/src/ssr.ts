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

// honoInertia()'s `ssr` option hands this to inertia({ assets }), so pages
// render in the server's own process, in dev and in production
const renderPage = (page: PageObject): Promise<SsrRenderResult> =>
  createInertiaApp({
    // Inertia's Page type also requires client-only state (rememberedState)
    // that no server sends
    page: page as Page,
    render: renderToString,
    resolve: (name) => pages[`./pages/${name}.vue`](),
    layout: () => Layout,
    setup: ({ App, props, plugin }) =>
      createSSRApp({ render: () => h(App, props) }).use(plugin),
  });

export default renderPage;
