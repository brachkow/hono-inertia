import { createInertiaApp } from '@inertiajs/react';
import type { Page } from '@inertiajs/core';
import type { PageObject } from '@brachkow/hono-inertia';
import type { ComponentType } from 'react';
import { renderToString } from 'react-dom/server';
import { Layout } from './Layout';

const pages = import.meta.glob<ComponentType>('./pages/**/*.tsx', {
  import: 'default',
});

// src/server.ts passes this to the adapter as ssr.render, so pages render in
// the server's own process, in dev and in production
const renderPage = (page: PageObject) =>
  createInertiaApp({
    // Inertia's Page type also requires client-only state (rememberedState)
    // that no server sends
    page: page as Page,
    render: renderToString,
    resolve: (name) => pages[`./pages/${name}.tsx`](),
    layout: () => Layout,
    setup: ({ App, props }) => <App {...props} />,
  });

export default renderPage;
