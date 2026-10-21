import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import inertia from '@inertiajs/vite';
import devServer from '@hono/vite-dev-server';
import { honoInertia } from '@brachkow/hono-inertia/vite-plugin';

const PORT = 3002;

export default defineConfig({
  plugins: [
    vue(),
    // ssr: false: otherwise @inertiajs/vite wraps src/ssr.ts in code that
    // starts Inertia's SSR server, and src/server.ts calls it directly instead.
    // The plugin still expands the `pages` shorthand.
    inertia({ ssr: false }),
    // Hands src/server.ts the asset tags and version, keeps the client
    // manifest out of the public build output, and builds the client before
    // the server
    honoInertia({
      entry: 'src/client.ts',
      // Writes src/pages.gen.ts, which types each page's props
      pages: { directory: 'src/pages', server: 'src/server.ts' },
    }),
    // Dev: Vite serves the client and runs the Hono app on the same port
    // src/server.ts already puts /@vite/client in <head>
    devServer({ entry: 'src/server.ts', injectClientScript: false }),
  ],
  // `vite build` builds every environment: the client into dist/client, then
  // the server from src/main.ts into dist/server
  builder: {},
  build: { outDir: 'dist/client' },
  environments: {
    ssr: {
      build: { outDir: 'dist/server', rollupOptions: { input: 'src/main.ts' } },
    },
  },
  server: { port: PORT, strictPort: true },
});
