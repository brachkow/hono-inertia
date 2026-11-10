// Types for the module that honoInertia() from
// @brachkow/hono-inertia/vite-plugin provides. Reference it with
// /// <reference types="@brachkow/hono-inertia/vite-plugin/client" />
declare module 'virtual:hono-inertia/assets' {
  // Matches ViteManifest from @brachkow/hono-inertia/vite. Declared here
  // because this file can't import its own package.
  interface ManifestChunk {
    file: string;
    src?: string;
    name?: string;
    isEntry?: boolean;
    isDynamicEntry?: boolean;
    css?: string[];
    assets?: string[];
    imports?: string[];
    dynamicImports?: string[];
  }

  // 'dev' under `vite dev`, otherwise a hash of the client build's file names
  export const version: string;
  // Script, modulepreload and stylesheet tags for the client entry
  export const assetTags: string;
  // assetTags plus the CSS and modulepreload tags of one page's chunks, so the
  // browser fetches the page with the entry instead of after it. Needs the
  // plugin's `pages` or `pageSource` option, and returns assetTags for a page
  // it does not know and under `vite dev`.
  export function assetTagsFor(component: string): string;
  // The client build's manifest, or null under `vite dev`
  export const manifest: Record<string, ManifestChunk> | null;
  // The default export of the plugin's `ssr` entry, or null without one.
  // Typed here rather than from the entry, so the app's type doesn't depend
  // on the SSR entry's, which reads the app's shared props.
  export const ssr:
    ((page: unknown) => Promise<{ head: string[]; body: string }>) | null;
}
