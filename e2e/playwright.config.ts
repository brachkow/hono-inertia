import { defineConfig, devices } from '@playwright/test';

interface Example {
  name: string;
  port: number;
  // Processes that serve the example's production build, run from its folder.
  // Playwright waits until each url responds.
  processes: Array<{ command: string; url: string }>;
  // The page component the HMR test edits, relative to the example's folder
  homePage: string;
}

// Every example implements the same pages, so one suite covers them all.
// Ports match each example's own config.
const EXAMPLES: Example[] = [
  {
    name: 'react-node',
    port: 3001,
    processes: [{ command: 'pnpm start', url: 'http://localhost:3001' }],
    homePage: 'src/pages/Home.tsx',
  },
  {
    name: 'vue-node',
    port: 3002,
    processes: [{ command: 'pnpm start', url: 'http://localhost:3002' }],
    homePage: 'src/pages/Home.vue',
  },
  {
    name: 'vue-workers',
    port: 3003,
    processes: [{ command: 'pnpm start', url: 'http://localhost:3003' }],
    homePage: 'src/pages/Home.vue',
  },
];

// The dev servers run next to the production ones, on their own ports
const DEV_PORT_OFFSET = 1000;

export interface ExampleOptions {
  // The page component the HMR test edits, relative to the repository root
  homePage: string;
}

// Playwright starts every webServer whatever --project selects, so
// E2E_EXAMPLES=vue-node,react-node limits both the servers and the projects.
const selected = process.env.E2E_EXAMPLES?.split(',');
const examples = selected
  ? EXAMPLES.filter((example) => selected.includes(example.name))
  : EXAMPLES;

const HMR_SPEC = /hmr\.spec\.ts/;

export default defineConfig<ExampleOptions>({
  testDir: 'tests',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
  projects: examples.flatMap((example) => {
    const browser = devices['Desktop Chrome'];
    const developmentURL = `http://localhost:${example.port + DEV_PORT_OFFSET}`;
    return [
      {
        name: example.name,
        testIgnore: HMR_SPEC,
        use: { ...browser, baseURL: `http://localhost:${example.port}` },
      },
      {
        name: `${example.name}-dev`,
        testIgnore: HMR_SPEC,
        use: { ...browser, baseURL: developmentURL },
      },
      // Editing a page reloads it in every open tab, so the HMR test waits
      // until the rest of the dev suite is done
      {
        name: `${example.name}-dev-hmr`,
        testMatch: HMR_SPEC,
        dependencies: [`${example.name}-dev`],
        use: {
          ...browser,
          baseURL: developmentURL,
          homePage: `examples/${example.name}/${example.homePage}`,
        },
      },
    ];
  }),
  // Examples are built beforehand (`pnpm test:e2e` at the repo root does it)
  webServer: examples.flatMap((example) => [
    ...example.processes.map(({ command, url }) => ({
      command,
      url,
      cwd: `../examples/${example.name}`,
      reuseExistingServer: !process.env.CI,
    })),
    {
      command: `pnpm dev --port ${example.port + DEV_PORT_OFFSET}`,
      url: `http://localhost:${example.port + DEV_PORT_OFFSET}`,
      cwd: `../examples/${example.name}`,
      reuseExistingServer: !process.env.CI,
    },
  ]),
});
