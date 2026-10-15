# Hono + Vue on Cloudflare Workers

A Hono app on Cloudflare Workers that serves Vue pages through `@brachkow/hono-inertia`, with server-side rendering. It has the same pages as the other examples: client-side navigation, deferred, optional and merge props, a form with validation errors, and a flash message after a redirect.

## Why SSR runs in the Worker

Inertia's usual SSR server is a separate Node process. Workers can't run one, so the Worker imports `src/ssr.ts` and passes its `renderPage` to the adapter as `ssr.render`. Every request renders in the same isolate, in dev and in production.

## Commands

- `pnpm dev` runs the Worker in workerd through Vite on http://localhost:3003, with hot reload for the client and the SSR entry
- `pnpm build` builds the client first, then the Worker, which inlines the client's asset tags
- `pnpm start` serves the production build locally with `vite preview` on port 3003
- `pnpm wrangler deploy` deploys the build to Cloudflare after `pnpm build`

## Key files

- `wrangler.jsonc` names the Worker and points `main` at `src/worker.ts`
- `vite.config.ts` adds the Vue, Inertia and Cloudflare plugins and builds the client before the Worker
- `src/worker.ts` is the Hono app: the adapter setup, routes, and the flash cookie
- `src/ssr.ts` renders a page to HTML for the Worker
- `src/client.ts` boots Inertia in the browser
- `src/Layout.vue` is the layout every page renders in
- `src/pages/` holds the page components that routes render by name
