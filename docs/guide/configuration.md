---
description: Every option of inertia(), and the built-in root template
---

# Configuration

```ts
import * as assets from 'virtual:hono-inertia/assets';

inertia({
  // The Vite plugin's virtual module. Gives the asset version, the asset tags
  // of the built-in template, and the plugin's SSR entry.
  assets,

  // Optional. Options for the built-in template (see Root template below)
  template: { lang: 'en', title: 'My app' },

  // Optional. Your own HTML instead of the built-in template. Receives the
  // page object, view data, the SSR result (undefined without SSR), and the
  // Hono context. See Root template below.
  render: (page, viewData, ssr, c) => html,

  // Optional. Asset version, as a string or a sync/async function. Defaults
  // to assets.version. Without either, version checks are off.
  version,

  // Global shared props, merged into every response
  share: (c) => ({
    auth: { user: getUser(c) },
  }),

  // Optional. The page.url sent to the client. Defaults to the request's path
  // and query. See Page URL below.
  resolveUrl: (c) => c.req.url,

  // Optional. Defaults to rendering with assets.ssr when the plugin has an
  // SSR entry. Posts the page object to an Inertia SSR server, or pass
  // { render } to render in the same process. enabled takes a function of
  // the context to turn SSR off for some requests.
  ssr: {
    url: 'http://127.0.0.1:13714',
    enabled: (c) => !c.req.path.startsWith('/admin'),
  },

  // Called when SSR fails and the page falls back to client-side rendering.
  // Defaults to console.error. Throw from it to fail the request instead.
  onSsrError: (error, page) =>
    logger.error({ error, component: page.component }),

  // Cache-Control for responses the adapter emits (see Caching under Security).
  // Defaults to 'private, no-cache, must-revalidate'. Set false to omit it.
  cacheControl: 'private, no-cache, must-revalidate',

  // Called when a deferred(fn).rescue() prop throws (see deferred under Prop types).
  // Defaults to console.error.
  onRescue: (error, prop) => logger.error({ error, prop }),

  // Optional. Keeps validation errors and flash data for the page after a
  // redirect in a signed cookie, or in a store you pass (see Sessions below)
  session: { secret: env.SESSION_SECRET },

  // Optional. Pages get every message per field as an array, instead of the
  // first one (see Validation below)
  allErrors: true,

  // Optional. Maps the name render() takes to the component name the client
  // resolves
  transformComponent: (name) => `Pages/${name}`,

  // Optional. Prefix and path of the short-lived cookies that carry
  // clearHistory() and preserveFragment() across redirects. Defaults to
  // 'inertia_' and '/'.
  flagCookies: { prefix: 'inertia_', path: '/' },
});
```

## Root template

Without a `render` option, `inertia()` renders the first visit's HTML itself:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>My app</title>
    <!-- SSR head, template.head, then the page's asset tags -->
  </head>
  <body>
    <script data-page="app" type="application/json">
      {"component":"Home",...}
    </script>
    <div id="app"></div>
  </body>
</html>
```

With SSR, the body is the SSR body instead, and the `<title>` is left out when the SSR head has one. `template` takes `lang`, `title`, `head` and `id`. `head` is HTML for `<head>`, such as a favicon or fonts, or a function of the page and the context that returns it. `id` is the root element's id, which `createInertiaApp()` reads, and defaults to `app`. The asset tags come from `assets.assetTagsFor(page.component)`, so the page's own chunks load with the entry (see [Preloading the page](/guide/assets#preloading-the-page)).

For other HTML, pass `render`. Embed the page with `serializePage(page)`, never a bare `JSON.stringify` (see [Security](/guide/security#embedding-the-page-object-xss)):

```ts
import { inertia, serializePage } from '@brachkow/hono-inertia';
import { assetTagsFor } from 'virtual:hono-inertia/assets';

inertia({
  assets,
  render: (page, viewData, ssr) =>
    ssr
      ? `<!DOCTYPE html><html><head>${ssr.head}${assetTagsFor(page.component)}</head><body>${ssr.body}</body></html>`
      : `<!DOCTYPE html><html><head>${assetTagsFor(page.component)}</head><body><script data-page="app" type="application/json">${serializePage(page)}</script><div id="app"></div></body></html>`,
});
```
