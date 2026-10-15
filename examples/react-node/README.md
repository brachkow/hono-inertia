# React and Node example

A Hono app on Node that serves React pages through `@brachkow/hono-inertia`, with server-side rendering. It covers:

- Client-side navigation with `Link`
- Shared props (`appName`)
- A merge prop with a "Load more" button
- An optional prop loaded by a partial reload
- A deferred prop
- A form with validation errors
- A flash message carried across a redirect in a cookie

The repo's Playwright suite in `e2e/` runs against this example's production build.

## Develop

```bash
pnpm dev
```

Vite serves the client and runs the Hono app on http://localhost:3001. Pages render on the server in the same process, so edits to the SSR code reload without restarting anything.

## Build and run

```bash
pnpm build
pnpm start:ssr
pnpm start:server
```

`pnpm build` runs Vite three times: the browser bundle goes to `dist/client`, Inertia's SSR server to `dist/ssr` and the Hono server to `dist/server`. Run `start:ssr` and `start:server` in separate terminals. The SSR server listens on port 13715, and the Hono server posts each page to it.

## Key files

- `vite.config.ts` sets up one build per mode and runs Hono inside Vite in dev
- `src/server.ts` is the Hono app: the adapter setup, the routes and the flash cookie
- `src/client.tsx` boots Inertia in the browser
- `src/ssr.tsx` renders a page to HTML, and starts Inertia's SSR server in production
- `src/Layout.tsx` is the default layout with navigation and the flash message
- `src/pages/` holds the page components that the server names in `render()`
