import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizePath } from 'vite';
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import { manifestFingerprint, VERSION_LENGTH } from './manifest.js';
import type { ViteManifest } from './manifest.js';

export interface HonoInertiaPluginOptions {
  // The client entry, relative to the Vite root, e.g. 'src/client.ts'
  entry: string;
  // Change it to force every open tab to reload after a server-only change
  // (same as the salt argument of manifestVersion)
  versionSalt?: string;
}

export const VIRTUAL_ASSETS_ID = 'virtual:hono-inertia/assets';
const RESOLVED_ASSETS_ID = `\0${VIRTUAL_ASSETS_ID}`;
const DEFAULT_MANIFEST_PATH = '.vite/manifest.json';
// Outside every output directory, so no static host can serve it. The server
// build reads it from here, also when it runs in a separate `vite build`.
const STORE_DIRECTORY = 'node_modules/.hono-inertia';

const escapeAttribute = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');

const collectChunks = (
  manifest: ViteManifest,
  key: string,
  seen: Set<string>,
): void => {
  if (seen.has(key) || !manifest[key]) return;
  seen.add(key);
  for (const imported of manifest[key].imports ?? []) {
    collectChunks(manifest, imported, seen);
  }
};

// The tags a page needs for the client entry: its CSS and the CSS of every
// chunk it statically imports, modulepreload for those chunks so the browser
// fetches them in parallel, then the entry script.
export const renderAssetTags = (
  manifest: ViteManifest,
  entry: string,
  base = '/',
): string => {
  const entryChunk = manifest[entry];
  if (!entryChunk) {
    throw new Error(
      `[hono-inertia] "${entry}" is not in the client manifest. Pass the same entry the client build uses.`,
    );
  }
  const chunks = new Set<string>();
  collectChunks(manifest, entry, chunks);
  const url = (file: string) => escapeAttribute(`${base}${file}`);

  const styles = [...chunks].flatMap((key) => manifest[key].css ?? []);
  const preloads = [...chunks]
    .filter((key) => key !== entry)
    .map((key) => manifest[key].file);

  return [
    ...Array.from(
      new Set(styles),
      (file) => `<link rel="stylesheet" href="${url(file)}">`,
    ),
    ...preloads.map((file) => `<link rel="modulepreload" href="${url(file)}">`),
    `<script type="module" src="${url(entryChunk.file)}"></script>`,
  ].join('');
};

// The same value manifestVersion() returns at runtime, computed once at build
// time with Node's crypto
export const versionFromManifest = (
  manifest: ViteManifest,
  salt = '',
): string =>
  createHash('sha256')
    .update(`${salt}:${manifestFingerprint(manifest)}`)
    .digest('hex')
    .slice(0, VERSION_LENGTH);

// Vite keys the manifest by the path relative to the root, so './src/client.ts'
// and an absolute path both have to become 'src/client.ts'
export const manifestKey = (root: string, entry: string): string =>
  normalizePath(path.relative(root, path.resolve(root, entry)));

const assetsModule = (version: string, assetTags: string): string =>
  `export const version = ${JSON.stringify(version)};\nexport const assetTags = ${JSON.stringify(assetTags)};\n`;

const HEAD_CONTENT = /<head>([\S\s]*)<\/head>/;

export const honoInertia = (options: HonoInertiaPluginOptions): Plugin => {
  let config: ResolvedConfig;
  let server: ViteDevServer | undefined;
  const storePath = () =>
    path.join(config.root, STORE_DIRECTORY, 'manifest.json');

  return {
    name: 'hono-inertia',

    configEnvironment(name, environmentConfig) {
      if (name !== 'client') return;
      const build = environmentConfig.build ?? {};
      const rollupOptions = build.rollupOptions ?? {};
      return {
        build: {
          manifest: build.manifest ?? true,
          rollupOptions: { input: rollupOptions.input ?? options.entry },
        },
      };
    },

    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },

    configureServer(developmentServer) {
      server = developmentServer;
    },

    // Runs once the client files are on disk: the manifest moves out of the
    // output directory, so it is never deployed as a public file
    async writeBundle() {
      if (this.environment.name !== 'client') return;
      const { manifest, outDir } = this.environment.config.build;
      if (!manifest) return;
      const relative = manifest === true ? DEFAULT_MANIFEST_PATH : manifest;
      const source = path.resolve(config.root, outDir, relative);
      const contents = await readFile(source, 'utf8');
      await mkdir(path.dirname(storePath()), { recursive: true });
      await writeFile(storePath(), contents);
      await rm(source);
      // Leaves the directory alone if anything else lives in it
      await rmdir(path.dirname(source)).catch(() => {});
    },

    resolveId(id) {
      return id === VIRTUAL_ASSETS_ID ? RESOLVED_ASSETS_ID : undefined;
    },

    async load(id) {
      if (id !== RESOLVED_ASSETS_ID) return;

      if (server) {
        // Vite's own HTML transform adds /@vite/client and whatever framework
        // plugins inject, such as the React Refresh preamble
        const html = await server.transformIndexHtml(
          '/',
          '<html><head></head><body></body></html>',
        );
        const head = HEAD_CONTENT.exec(html)?.[1] ?? '';
        const entry = `<script type="module" src="${escapeAttribute(`${config.base}${manifestKey(config.root, options.entry)}`)}"></script>`;
        return assetsModule('dev', `${head}${entry}`);
      }

      const contents = await readFile(storePath(), 'utf8').catch(() => {
        this.error(
          `[hono-inertia] No client manifest at ${storePath()}. Build the client before the server.`,
        );
      });
      const manifest = JSON.parse(contents) as ViteManifest;
      return assetsModule(
        versionFromManifest(manifest, options.versionSalt),
        renderAssetTags(
          manifest,
          manifestKey(config.root, options.entry),
          config.base,
        ),
      );
    },
  };
};
