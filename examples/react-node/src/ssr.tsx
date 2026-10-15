import { createInertiaApp } from '@inertiajs/react';
import createServer from '@inertiajs/react/server';
import type { Page } from '@inertiajs/core';
import type { ComponentType } from 'react';
import { renderToString } from 'react-dom/server';
import { Layout } from './Layout';

// Must match SSR_URL in src/server.ts
const SSR_PORT = 13_715;

const pages = import.meta.glob<ComponentType>('./pages/**/*.tsx', {
  import: 'default',
});

const renderPage = (page: Page) =>
  createInertiaApp({
    page,
    render: renderToString,
    resolve: (name) => pages[`./pages/${name}.tsx`](),
    layout: () => Layout,
    setup: ({ App, props }) => <App {...props} />,
  });

// Production runs this file as Inertia's SSR server (`pnpm start:ssr`). In dev,
// src/server.ts imports renderPage and renders in-process instead.
if (import.meta.env.PROD) {
  createServer(renderPage, { port: SSR_PORT });
}

export default renderPage;
