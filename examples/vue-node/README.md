# Hono + Vue on Node.js

A Hono app on Node.js that serves Vue pages through `@brachkow/hono-inertia`, with server-side rendering. It shows:

- Navigation between pages with Inertia's `Link`
- Shared props (`appName`) and page props
- Partial reloads of an `optional()` prop
- A `deferred()` prop that loads after the page renders
- A `merge()` prop that appends the next page of users
- A form with validation errors, and a flash message after the redirect

The same pages exist in the other examples, and one Playwright suite in `e2e/` runs against all of them.

## Running it

From the repository root, install dependencies once with `pnpm install`. Then, in this folder:

```bash
pnpm dev
```

This starts Vite on http://localhost:3002. `@hono/vite-dev-server` runs the Hono app inside Vite, and pages render on the server in the same process.

For a production build:

```bash
pnpm build
pnpm start:ssr     # Inertia's SSR server on port 13716
pnpm start:server  # The Hono app on port 3002
```

Run the two `start` commands in separate terminals. The Hono app posts each page to the SSR server through `ssr.url`, and falls back to client-side rendering if the SSR server is down.

## How it fits together

`pnpm build` runs Vite three times, once per mode in `vite.config.ts`:

1. `client` builds the browser bundle into `dist/client`, with a manifest
2. `ssr` builds `src/ssr.ts` into `dist/ssr`, Inertia's SSR server
3. The default mode builds `src/server.ts` into `dist/server` with `@hono/vite-build`, which adds the Node server and serves `dist/client/assets`

## Key files

- `src/server.ts` is the Hono app: the `inertia()` middleware, routes, and the flash cookie
- `src/client.ts` boots Inertia in the browser
- `src/ssr.ts` renders a page to HTML, and runs as the SSR server in production
- `src/Layout.vue` is the default layout with the navigation and the flash message
- `src/pages/` holds the page components that `render()` names
- `vite.config.ts` holds the three build modes and the dev server
