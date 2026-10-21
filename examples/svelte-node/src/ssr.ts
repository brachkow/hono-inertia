import { createInertiaApp } from '@inertiajs/svelte';
import type { ResolvedComponent } from '@inertiajs/svelte';
import type { Page } from '@inertiajs/core';
import type { PageObject } from '@brachkow/hono-inertia';
import { render } from 'svelte/server';
import Layout from './Layout.svelte';

// Whole modules: Svelte's resolver takes { default, layout? }, not the component
const pages = import.meta.glob<ResolvedComponent>('./pages/**/*.svelte');

// src/server.ts passes this to the adapter as ssr.render, so pages render in
// the server's own process, in dev and in production
const renderPage = async (page: PageObject) => {
  const result = await createInertiaApp({
    // Inertia's Page type also requires client-only state (rememberedState)
    // that no server sends
    page: page as Page,
    resolve: (name) => pages[`./pages/${name}.svelte`](),
    layout: () => Layout,
    setup: ({ App, props }) => render(App, { props }),
  });
  // With a page and a setup that returns HTML, createInertiaApp always
  // resolves to a result; its type also covers the browser, where it doesn't
  if (!result) throw new Error('createInertiaApp rendered nothing');
  return result;
};

export default renderPage;
