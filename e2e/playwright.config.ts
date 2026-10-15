import { defineConfig, devices } from '@playwright/test';

interface Example {
  name: string;
  port: number;
  // Processes that serve the example's production build, run from its folder.
  // Playwright waits until each url responds.
  processes: Array<{ command: string; url: string }>;
}

// Every example implements the same pages, so one suite covers them all.
// Ports match each example's own config.
const EXAMPLES: Example[] = [
  {
    name: 'react-node',
    port: 3001,
    processes: [
      { command: 'pnpm start:ssr', url: 'http://127.0.0.1:13715/health' },
      { command: 'pnpm start:server', url: 'http://localhost:3001' },
    ],
  },
  {
    name: 'vue-node',
    port: 3002,
    processes: [
      { command: 'pnpm start:ssr', url: 'http://127.0.0.1:13716/health' },
      { command: 'pnpm start:server', url: 'http://localhost:3002' },
    ],
  },
  {
    name: 'vue-workers',
    port: 3003,
    processes: [{ command: 'pnpm start', url: 'http://localhost:3003' }],
  },
];

// Playwright starts every webServer whatever --project selects, so
// E2E_EXAMPLES=vue-node,react-node limits both the servers and the projects.
const selected = process.env.E2E_EXAMPLES?.split(',');
const examples = selected
  ? EXAMPLES.filter((example) => selected.includes(example.name))
  : EXAMPLES;

export default defineConfig({
  testDir: 'tests',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
  projects: examples.map((example) => ({
    name: example.name,
    use: {
      ...devices['Desktop Chrome'],
      baseURL: `http://localhost:${example.port}`,
    },
  })),
  // Examples are built beforehand (`pnpm test:e2e` at the repo root does it)
  webServer: examples.flatMap((example) =>
    example.processes.map(({ command, url }) => ({
      command,
      url,
      cwd: `../examples/${example.name}`,
      reuseExistingServer: !process.env.CI,
    })),
  ),
});
