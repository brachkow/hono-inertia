// Types for the module that honoInertia() from
// @brachkow/hono-inertia/vite-plugin provides. Reference it with
// /// <reference types="@brachkow/hono-inertia/vite-plugin/client" />
declare module 'virtual:hono-inertia/assets' {
  // 'dev' under `vite dev`, otherwise a hash of the client build's file names
  export const version: string;
  // Script, modulepreload and stylesheet tags for the client entry
  export const assetTags: string;
}
