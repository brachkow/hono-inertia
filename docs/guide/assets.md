---
description: Asset versioning, the Vite plugin and preloading pages
---

# Asset versioning

Every Inertia response carries `page.version`. When a client's `X-Inertia-Version` header no longer matches the server's version, the adapter answers a GET with `409` and `X-Inertia-Location`, and the client performs a full page visit, which loads the new HTML and asset URLs. This keeps a tab that stayed open across a deploy from requesting content-hashed chunks that no longer exist.

The 409 also carries the new version in `X-Inertia-Version`. The client uses it to tell a deploy-driven reload from a plain `location()` redirect. It fires a cancelable `inertia:location` event with `versionChange: true`. For background `async` visits (polling, prefetching, deferred props) it skips the forced reload, so the next visit the user starts picks up the new assets without interrupting them.

## Vite plugin

`honoInertia()` connects the server to the client build. It gives the server the version and the HTML tags that load the client:

```ts
// vite.config.ts
import { honoInertia } from '@brachkow/hono-inertia/vite-plugin';

export default defineConfig({
  plugins: [vue(), inertia(), honoInertia({ entry: 'src/client.ts' })],
});
```

```ts
// server.ts
import * as assets from 'virtual:hono-inertia/assets';

app.use(inertia({ assets }));
```

The module exports `version`, `assetTags`, `assetTagsFor()`, `manifest` and `ssr`. A custom `render` can import them by name.

Add `/// <reference types="@brachkow/hono-inertia/vite-plugin/client" />` to a `.d.ts` file in your project to type the `virtual:hono-inertia/assets` import.

- In production, `assetTags` holds the client entry's script, `modulepreload` links for the chunks it imports, and the stylesheets of all of them. With `build.cssCodeSplit: false`, it links the single CSS file Vite writes instead. Every tag carries `crossorigin`, as in Vite's own HTML output. URLs follow Vite's `base`. `version` is the same hash `manifestVersion` computes (see below).
- Under `vite dev`, `assetTags` is whatever Vite's own HTML transform adds, such as `/@vite/client` and the React Refresh preamble, followed by the entry script. `version` is `'dev'`.
- The plugin turns on the client build's manifest and sets the entry as its input, unless you set either yourself. Once the client build is written, the plugin moves the manifest to `node_modules/.hono-inertia/`. The manifest lists every page and source path, and static hosts such as Workers would otherwise serve it to anyone. The server build reads it from there.
- In an app build (`builder` in the Vite config, as Cloudflare's plugin sets), the plugin builds the client before the other environments, because they inline its asset tags. In separate `vite build` runs, build the client first.
- Pass `versionSalt` to change the version without a client change, as with the salt argument below.
- Pass `pages` to generate the types for [typed page props](/guide/typescript#typed-page-props).
- Pass `ssr` with the SSR entry's path, and the module exports its default export as `ssr`, which `inertia({ assets })` renders with (see [SSR](/guide/ssr)). Without it, `ssr` is `null`.
- `manifest` is the parsed client manifest, for building your own tags. It is `null` under `vite dev`.

Vite 7 or newer is required.

### Preloading the page

A page component that the client loads with `import.meta.glob` starts downloading only after the entry ran and Inertia picked the component. `assetTagsFor(page.component)` returns `assetTags` plus the stylesheets and `modulepreload` links of that page and the chunks it imports, so the browser fetches them together with the entry. The built-in template uses it, and a custom `render` can too:

```ts
import { assetTagsFor } from 'virtual:hono-inertia/assets';

render: (page) =>
  `<!DOCTYPE html><html><head>${assetTagsFor(page.component)}</head><body>...</body></html>`,
```

It leaves out what the entry already loads. With the `pages` option, the plugin knows which file each page name stands for. Without it, pass `pageSource` with `[name]` in place of the page name, or a list of patterns for several extensions:

```ts
honoInertia({ entry: 'src/client.ts', pageSource: 'src/pages/[name].vue' });
```

`[name]` can appear more than once, and every copy has to match the same name. `'src/views/[name]/[name].vue'` finds `Landing` in `src/views/Landing/Landing.vue`.

For a page the plugin does not know, and under `vite dev`, `assetTagsFor()` returns `assetTags`.

## Without the plugin

Derive the version from your Vite manifest with `manifestVersion`:

```ts
import manifest from './dist/client/.vite/manifest.json';
import { inertia } from '@brachkow/hono-inertia';
import { manifestVersion } from '@brachkow/hono-inertia/vite';

app.use(inertia({ version: manifestVersion(manifest), render }));
```

- It hashes the sorted emitted filenames (sha256, 16 hex chars), not the manifest JSON. Vite already puts content hashes in filenames, so the version changes exactly when an open tab's chunk URLs stop working. A server-only deploy does not force-reload every open tab, as a commit SHA or deployment ID would. Reordered manifest keys or changed metadata don't change the version.
- `manifestVersion` computes the hash once per isolate and memoizes it. It doesn't touch the file system and uses only WebCrypto, so it works on Workers, Deno, Bun, and Node.
- Pass a salt as the second argument, `manifestVersion(manifest, salt)`, and change it to force a global reload after a server-only change that breaks the prop contract with old bundles.
- `vite dev` produces no manifest, so use a constant in development, for example `version: import.meta.env.PROD ? manifestVersion(manifest) : 'dev'`.

Whatever you use as a version, keep it short. The client sends it back verbatim in the `X-Inertia-Version` request header on every visit, and proxies reject requests with headers over about 8 to 16 KB (Cloudflare: 16 KB). Never use the manifest contents themselves.

Omitting `version` disables the check (`page.version` is `null`). A missing or empty client header never triggers a 409 either.

## Recovering from dead chunks (`vite:preloadError`)

The 409 mechanism covers chunks loaded through an Inertia GET. It can't cover dynamic imports unrelated to a visit (`import('some-lib')` on a button click), or a deploy that lands after the version check passed but before the `import()` ran. For those cases, add a `vite:preloadError` listener in the app that navigates once. Vite dispatches this event for failing dynamic imports, not only for preload links:

```ts
import { router } from '@inertiajs/vue3'; // or react / svelte

let pendingUrl: string | null = null;
router.on('start', (event) => {
  pendingUrl = event.detail.visit.url.href;
});

const RELOADED_AT = 'inertia:chunk-reload';
const COOLDOWN_MS = 10_000;

const sessionStorageUsable = () => {
  try {
    window.sessionStorage.getItem(RELOADED_AT);
    return true;
  } catch {
    return false;
  }
};

window.addEventListener('vite:preloadError', (event) => {
  if (!sessionStorageUsable()) return;
  const last = Number(sessionStorage.getItem(RELOADED_AT) ?? 0);
  if (Date.now() - last < COOLDOWN_MS) return;
  sessionStorage.setItem(RELOADED_AT, String(Date.now()));
  event.preventDefault();
  window.location.assign(pendingUrl ?? window.location.href);
});
```

Four details matter:

1. **Navigate to the target URL, not the current one.** Inertia resolves the page component before it pushes history state, so when the chunk fails, the address bar still shows the old page. A bare `location.reload()` re-renders the page the user was already on, and the click appears to do nothing. Take the pending URL from `router.on('start')`.
2. **Persist the cooldown timestamp instead of using an in-memory flag or one cleared on boot.** The reload loop happens across documents, and the entry chunk always boots (only the view chunk returns 404), so any flag reset on boot lets the loop run forever.
3. **Use `sessionStorage`, not `localStorage`.** Staleness belongs to one tab's document. With `localStorage`, one tab's reload would suppress a reload another tab needs. Accessing `window.sessionStorage` throws in blocked or partitioned storage contexts, so probe it and fail closed by letting the error surface instead of looping.
4. **Call `preventDefault()` only on the path that navigates.** Otherwise the import resolves to `undefined` and the caller throws a `TypeError` anyway.
