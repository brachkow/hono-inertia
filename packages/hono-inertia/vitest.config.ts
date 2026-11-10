import { defineConfig } from 'vitest/config';

const HONO_IMPORT = /^hono(\/.*)?$/;
const VITE_IMPORT = /^vite$/;

// Runs the suite with every `hono` import, in src and tests, swapped for an
// aliased install, so one test run covers each Hono the peer range allows.
const honoAlias = (target: string) => ({
  find: HONO_IMPORT,
  replacement: `${target}$1`,
});

export default defineConfig({
  test: {
    globals: true,
    // Only our suite — never the vendored upstream specs under .inertia/
    include: ['tests/**/*.test.ts'],
    projects: [
      { extends: true, test: { name: 'hono-4' } },
      // The oldest Hono and Vite the peer ranges allow: Hono 4.8.0 is the first
      // release with the hono/route helper the adapter imports, and Vite 7.0.0
      // the first to run plugin buildApp hooks
      {
        extends: true,
        resolve: {
          alias: [
            honoAlias('hono-4.8.0'),
            { find: VITE_IMPORT, replacement: 'vite-7.0.0' },
          ],
        },
        test: { name: 'lowest' },
      },
      {
        extends: true,
        resolve: { alias: [honoAlias('hono-5')] },
        test: { name: 'hono-5' },
      },
    ],
  },
});
