import { createInertiaApp } from '@inertiajs/react';
import type { Page } from '@inertiajs/core';
import type { PageObject, SsrRenderResult } from '@brachkow/hono-inertia';
import type { ComponentType } from 'react';
import { renderToString } from 'react-dom/server';
import { Layout } from './Layout';

const pages = import.meta.glob<ComponentType>('./pages/**/*.tsx', {
  import: 'default',
});

// src/server.ts passes this to the adapter as ssr.render, so pages render in
// the server's own process, in dev and in production
// The return type is written out. Inferring it goes through the types of
// createInertiaApp(), which read sharedPageProps from src/pages.gen.ts, and
// those come from the app that holds this function, so TypeScript would loop.
const renderPage = (page: PageObject): Promise<SsrRenderResult> =>
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
