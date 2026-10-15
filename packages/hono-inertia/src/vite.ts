// Runtime helpers, safe on Workers. The build-time plugin lives in
// ./vite-plugin.ts because it needs Node's file system.
export { manifestVersion } from './manifest.js';
export type { ViteManifest, ViteManifestChunk } from './manifest.js';
