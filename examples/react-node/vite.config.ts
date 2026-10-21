import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import inertia from '@inertiajs/vite';
import devServer from '@hono/vite-dev-server';
import build from '@hono/vite-build/node';
import { honoInertia } from '@brachkow/hono-inertia/vite-plugin';

const PORT = 3001;

// `vite build` runs once per mode (see the build script in package.json):
// client → the browser bundle, production → the Hono server, which also
// renders pages on the server. The client builds first, so the server can
// inline its asset tags.
export default defineConfig(({ mode }) => {
  // ssr: false: otherwise @inertiajs/vite wraps src/ssr.tsx in code that
  // starts Inertia's SSR server, and src/server.ts calls it directly instead.
  // The plugin still expands the `pages` shorthand.
  // honoInertia() hands src/server.ts the asset tags and version, and keeps
  // the client manifest out of the public build output
  const shared = [
    react(),
    inertia({ ssr: false }),
    honoInertia({
      entry: 'src/client.tsx',
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
