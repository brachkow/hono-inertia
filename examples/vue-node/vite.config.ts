import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import inertia from '@inertiajs/vite';
import devServer from '@hono/vite-dev-server';
import build from '@hono/vite-build/node';
import { honoInertia } from '@brachkow/hono-inertia/vite-plugin';

const PORT = 3002;

// `vite build` runs once per mode (see the build script in package.json):
// client → the browser bundle, ssr → Inertia's SSR server, production → Hono.
export default defineConfig(({ mode }) => {
  // ssr: false: src/ssr.ts starts its own server, so @inertiajs/vite must not
  // wrap it. The plugin still expands the `pages` shorthand.
  // honoInertia() hands src/server.ts the asset tags and version, and keeps
  // the client manifest out of the public build output
  const shared = [
    vue(),
    inertia({ ssr: false }),
    honoInertia({
      entry: 'src/client.ts',
      // Writes src/pages.gen.ts, which types each page's props
      pages: { directory: 'src/pages', server: 'src/server.ts' },
    }),
  ];

  if (mode === 'client') {
    return {
      plugins: shared,
      build: { outDir: 'dist/client' },
    };
  }

  if (mode === 'ssr') {
    // Inertia's SSR server, run with `pnpm start:ssr`
    return {
      plugins: shared,
      build: { ssr: 'src/ssr.ts', outDir: 'dist/ssr' },
    };
  }

  return {
    plugins: [
      ...shared,
      // Dev: Vite serves the client and runs the Hono app on the same port
      // src/server.ts already puts /@vite/client in <head>
      devServer({ entry: 'src/server.ts', injectClientScript: false }),
      build({
        entry: 'src/server.ts',
        outputDir: 'dist/server',
        port: PORT,
        // Hashed client assets, served relative to where `start:server` runs
        staticPaths: ['/assets/*'],
        staticRoot: './dist/client',
      }),
    ],
    server: { port: PORT, strictPort: true },
  };
});
