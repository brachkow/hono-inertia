import { createInertiaApp } from '@inertiajs/svelte';
import Layout from './Layout.svelte';

await createInertiaApp({
  // @inertiajs/vite turns this into a resolver over src/pages/**/*.svelte
  pages: './pages',
  layout: () => Layout,
});
