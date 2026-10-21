import { createInertiaApp } from '@inertiajs/react';
import { Layout } from './Layout';

await createInertiaApp({
  // @inertiajs/vite turns this into a resolver over src/pages/**/*.tsx
  pages: './pages',
  layout: () => Layout,
});
