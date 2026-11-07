import { createInertiaApp } from '@inertiajs/vue3';
import Layout from './Layout.vue';

await createInertiaApp({
  // @inertiajs/vite turns this into a resolver over src/pages/**/*.vue
  pages: './pages',
  layout: () => Layout,
});
