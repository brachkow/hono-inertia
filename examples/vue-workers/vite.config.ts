import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import inertia from '@inertiajs/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { honoInertia } from '@brachkow/hono-inertia/vite-plugin';

const PORT = 3003;

export default defineConfig({
  plugins: [
    vue(),
    // ssr: false: Workers can't run Inertia's Node SSR server, so the Worker
    // imports src/ssr.ts and renders in-process. The plugin still expands
    // the `pages` shorthand in src/client.ts.
    inertia({ ssr: false }),
    // Hands src/worker.ts the asset tags and version, keeps the client
    // manifest out of the static assets, and builds the client before the
    // Worker
    honoInertia({
      entry: 'src/client.ts',
      // Writes src/pages.gen.ts, which types each page's props
      pages: { directory: 'src/pages', server: 'src/worker.ts' },
    }),
    // Runs the Worker in workerd during `vite dev` and `vite preview`
    cloudflare({ viteEnvironment: { name: 'worker' } }),
  ],
  server: { port: PORT, strictPort: true },
  preview: { port: PORT, strictPort: true },
});
