import { createHash } from 'node:crypto';
import {
  mkdir,
  readdir,
  readFile,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { normalizePath } from 'vite';
import type {
  BuildEnvironment,
  Plugin,
  ResolvedConfig,
  ViteBuilder,
  ViteDevServer,
} from 'vite';
import { manifestFingerprint, VERSION_LENGTH } from './manifest.js';
import type { ViteManifest } from './manifest.js';

export interface HonoInertiaPluginOptions {
  // The client entry, relative to the Vite root, e.g. 'src/client.ts'
  entry: string;
  // Change it to force every open tab to reload after a server-only change
  // (same as the salt argument of manifestVersion)
  versionSalt?: string;
  // Generates a file that lists the page components and registers the app's
  // type, so render() only accepts known pages and PageProps<'Home'> gives
  // the props the routes pass to Home
  pages?: PagesOptions;
}

export interface PagesOptions {
  // The folder with the page components, relative to the Vite root,
  // e.g. 'src/pages'. A page's name is its path in it without the extension.
  directory: string;
  // The module whose default export is the Hono app, relative to the Vite
  // root, e.g. 'src/server.ts'. Routes must be chained on the app
  // (`new Hono().use(...).get(...)`) for their types to reach PageProps.
  server: string;
  // Where to write the file, relative to the Vite root.
  // Defaults to the directory's path plus '.gen.ts', e.g. 'src/pages.gen.ts'
  output?: string;
  // Default: ['tsx', 'jsx', 'vue', 'svelte']
  extensions?: string[];
  // Page names to leave out, e.g. ['Layout']
  exclude?: string[];
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

const PACKAGE_NAME = '@brachkow/hono-inertia';
const DEFAULT_PAGE_EXTENSIONS = ['tsx', 'jsx', 'vue', 'svelte'];
const IDENTIFIER = /^[$A-Z_a-z][\w$]*$/;
const SCRIPT_EXTENSION = /\.[cm]?[jt]sx?$/;

const listFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
};

// Matches the repository's Prettier style, so formatting it changes nothing
export interface PageFile {
  // The name render() takes, e.g. 'Users/Index'
  name: string;
  // The component, relative to the generated file, e.g. './pages/Home.vue'
  importPath: string;
}

// 'Users/Index' → 'UsersIndexPage'
const NON_IDENTIFIER = /[^\dA-Za-z]+/;

const componentIdentifier = (name: string) =>
  `${name
    .split(NON_IDENTIFIER)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')}Page`;

// Vue pages list their props by hand (defineProps can't take PageProps), so
// the file checks each list against what the routes pass
const renderVueChecks = (pages: PageFile[]) => {
  const vuePages = pages.filter((page) => page.importPath.endsWith('.vue'));
  if (vuePages.length === 0) return { imports: [], checks: [] };
  // 'Users-Index' and 'Users/Index' would both be UsersIndexPage
  const taken = new Set<string>();
  const identifiers = vuePages.map((page) => {
    const base = componentIdentifier(page.name);
    let identifier = base;
    for (let suffix = 2; taken.has(identifier); suffix += 1) {
      identifier = `${base}${suffix}`;
    }
    taken.add(identifier);
    return identifier;
  });
  return {
    imports: [
      `import type { VuePage } from '${PACKAGE_NAME}';`,
      ...vuePages.map(
        (page, index) =>
          `import type ${identifiers[index]} from '${page.importPath}';`,
      ),
    ],
    checks: [
      '',
      "// Fails typecheck when a Vue page doesn't declare a prop its routes pass",
      'export type VuePages = [',
      ...vuePages.map(
        (page, index) =>
          `  VuePage<'${page.name}', typeof ${identifiers[index]}>,`,
      ),
      '];',
    ],
  };
};

// Matches the repository's Prettier style, so formatting it changes nothing
export const renderPagesFile = (pages: PageFile[], serverImport: string) => {
  const entries = pages.map(
    ({ name }) => `    ${IDENTIFIER.test(name) ? name : `'${name}'`}: true;`,
  );
  const vue = renderVueChecks(pages);
  return [
    `// Generated by ${PACKAGE_NAME}/vite-plugin from the pages folder. Do not edit.`,
    `import type app from '${serverImport}';`,
    ...vue.imports,
    '',
    `declare module '${PACKAGE_NAME}' {`,
    '  interface InertiaPages {',
    ...entries,
    '  }',
    '  interface AppRegistry {',
    '    app: typeof app;',
    '  }',
    '}',
    '',
    `export type { PageProps } from '${PACKAGE_NAME}';`,
    ...vue.checks,
    '',
  ].join('\n');
};

const createPagesFile = (root: string, options: PagesOptions) => {
  const directory = path.resolve(root, options.directory);
  const output = path.resolve(
    root,
    options.output ?? `${options.directory}.gen.ts`,
  );
  const extensions = new Set(
    (options.extensions ?? DEFAULT_PAGE_EXTENSIONS).map(
      (extension) => `.${extension}`,
    ),
  );
  const exclude = new Set(options.exclude);
  const importPath = (file: string) => {
    const relative = normalizePath(path.relative(path.dirname(output), file));
    return relative.startsWith('.') ? relative : `./${relative}`;
  };
  const serverImport = importPath(path.resolve(root, options.server)).replace(
    SCRIPT_EXTENSION,
    '',
  );

  const isPage = (file: string) =>
    file.startsWith(directory + path.sep) && extensions.has(path.extname(file));

  const pageName = (file: string) => {
    const relative = normalizePath(path.relative(directory, file));
    return relative.slice(0, relative.length - path.extname(file).length);
  };

  const write = async () => {
    const files = await listFiles(directory);
    const pages = files
      .filter((file) => isPage(file))
      .map((file) => ({ name: pageName(file), importPath: importPath(file) }))
      .filter((page) => !exclude.has(page.name))
      .toSorted((a, b) => (a.name < b.name ? -1 : 1));
    const contents = renderPagesFile(pages, serverImport);
    // Rewriting an unchanged file would trigger the watcher and a reload
    const current = await readFile(output, 'utf8').catch(() => '');
    if (current === contents) return;
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, contents);
  };

  return { isPage, write };
};

const assetsModule = (version: string, assetTags: string): string =>
  `export const version = ${JSON.stringify(version)};\nexport const assetTags = ${JSON.stringify(assetTags)};\n`;

const HEAD_CONTENT = /<head>([\S\s]*)<\/head>/;
// @inertiajs/react/server and the like, as an external import or bundled
const INERTIA_SSR_SERVER =
  /@inertiajs[/\\][\w-]+[/\\](?:dist[/\\])?server(?:\.[cm]?js)?$/;

const isUnbuiltClient = (environment: BuildEnvironment) =>
  environment.name === 'client' && !environment.isBuilt;

// Server environments inline the client's asset tags, so in an app build
// (`builder` in the Vite config) the client has to build first
const buildClientFirst = async (builder: ViteBuilder) => {
  const environments = Object.values(builder.environments);
  const client = environments.find((environment) =>
    isUnbuiltClient(environment),
  );
  if (client && environments.length > 1) await builder.build(client);
};

// Vite builds every environment only when nothing is built yet, which the
// client build above rules out. Builds the rest unless another plugin's
// buildApp already did, such as @cloudflare/vite-plugin's.
const buildTheRest = async (builder: ViteBuilder) => {
  const environments = Object.values(builder.environments);
  const othersBuilt = environments.some(
    (environment) => environment.name !== 'client' && environment.isBuilt,
  );
  if (othersBuilt) return;
  for (const environment of environments) {
    if (!environment.isBuilt) await builder.build(environment);
  }
};

export const honoInertia = (options: HonoInertiaPluginOptions): Plugin[] => {
  let config: ResolvedConfig;
  let server: ViteDevServer | undefined;
  let pagesFile: ReturnType<typeof createPagesFile> | undefined;
  const storePath = () =>
    path.join(config.root, STORE_DIRECTORY, 'manifest.json');

  const main: Plugin = {
    name: 'hono-inertia',

    buildApp: { order: 'pre', handler: buildClientFirst },

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

    async configResolved(resolvedConfig) {
      config = resolvedConfig;
      if (options.pages) {
        pagesFile = createPagesFile(config.root, options.pages);
        await pagesFile.write();
      }
    },

    configureServer(developmentServer) {
      server = developmentServer;
      if (!pagesFile) return;
      const { isPage, write } = pagesFile;
      const onChange = (file: string) => {
        if (isPage(file)) void write();
      };
      developmentServer.watcher.on('add', onChange);
      developmentServer.watcher.on('unlink', onChange);
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

    // @inertiajs/vite wraps an SSR entry that calls createInertiaApp() as a
    // statement in code that starts Inertia's SSR server. A server that also
    // uses the asset tags renders in-process, so that second server only
    // starts on import and holds a port. Fails the build instead of shipping it.
    generateBundle(_options, bundle) {
      if (this.environment.name === 'client') return;
      const ids = Object.values(bundle).flatMap((output) =>
        output.type === 'chunk'
          ? [...output.moduleIds, ...output.imports, ...output.dynamicImports]
          : [],
      );
      if (!ids.includes(RESOLVED_ASSETS_ID)) return;
      const inertiaServer = ids.find((id) => INERTIA_SSR_SERVER.test(id));
      if (!inertiaServer) return;
      this.error(
        `[hono-inertia] The server bundle includes Inertia's SSR server (${inertiaServer}), which starts a second server next to ssr.render. @inertiajs/vite adds it around an SSR entry that calls createInertiaApp() at the top level, unless you pass { ssr: false } to it. Export a render function from the SSR entry instead (see README → SSR).`,
      );
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

  // A second plugin, because one plugin has one buildApp hook and this one
  // has to run after Vite's and the other plugins' builds
  return [
    main,
    {
      name: 'hono-inertia:build',
      buildApp: { order: 'post', handler: buildTheRest },
    },
  ];
};
