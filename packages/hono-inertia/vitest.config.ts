import { defineConfig } from 'vitest/config';

const HONO_IMPORT = /^hono(\/.*)?$/;

// Runs the suite with every `hono` import, in src and tests, swapped for an
// aliased install, so one test run covers each Hono the peer range allows.
const honoAlias = (target: string) => ({
  alias: [{ find: HONO_IMPORT, replacement: `${target}$1` }],
});

export default defineConfig({
  test: {
    globals: true,
    // Only our suite — never the vendored upstream specs under .inertia/
    include: ['tests/**/*.test.ts'],
    projects: [
      { extends: true, test: { name: 'hono-4' } },
      // The oldest Hono the peer range allows: 4.8.0 is the first release with
      // the hono/route helper the adapter imports.
      {
        extends: true,
        resolve: honoAlias('hono-4.8.0'),
        test: { name: 'hono-4.8.0' },
      },
      { extends: true, resolve: honoAlias('hono-5'), test: { name: 'hono-5' } },
    ],
  },
});
