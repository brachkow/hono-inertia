import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import app from './server';

// The production server, which `vite build` builds into dist/server. In dev,
// @hono/vite-dev-server runs src/server.ts inside Vite instead.
const PORT = Number(process.env.PORT ?? 3001);

const main = new Hono()
  // Hashed client assets, relative to where `pnpm start` runs
  .use('/assets/*', serveStatic({ root: './dist/client' }))
  .route('/', app);

serve({ fetch: main.fetch, port: PORT });
