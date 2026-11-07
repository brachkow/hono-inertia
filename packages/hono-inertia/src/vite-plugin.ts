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
  // Without `pages`, where assetTagsFor() finds a page component: its path
  // relative to the Vite root with [name] for the page name, e.g.
  // 'src/pages/[name].vue'. Several patterns for several extensions.
  pageSource?: string | string[];
}

export interface PagesOptions {
  // The folder with the page components, relative to the Vite root,
  // e.g. 'src/pages'. A page's name is its path in it without the extension.
  directory: string;
  // The module that exports the Hono app, relative to the Vite root, e.g.
  // 'src/server.ts'. Routes must be chained on the app
  // (`new Hono().use(...).get(...)`) for their types to reach PageProps.
  server: string;
  // The export of `server` that holds the app. Defaults to 'default'. Use a
  // named export when the default export is a Workers handler object.
  export?: string;
  // Also declares the app's shared props as @inertiajs/core's
  // sharedPageProps, so the client's usePage() and page props see them.
  // Needs @inertiajs/core as a direct dependency, and replaces a hand-written
  // sharedPageProps declaration.
  sharedPageProps?: boolean;
  // Names a page from its path in `directory`, e.g. 'Landing/Landing.vue',
  // or returns null for a file that is not a page. Defaults to the path
  // without the extension.
  name?: (relativePath: string) => string | null | undefined;
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

export interface AssetTagOptions {
  // The client build's build.cssCodeSplit. With false, Vite writes all CSS to
  // one file that no chunk lists, so the tags link it on its own.
  cssCodeSplit?: boolean;
  // The manifest key of a lazily loaded page, e.g. 'src/pages/Home.vue'. Adds
  // its CSS and preloads its chunks, so the browser fetches them together
  // with the entry instead of after it.
  page?: string;
}

interface TagParts {
  styles: string;
  preloads: string;
}

// crossorigin as in Vite's own HTML output: a preload is only reused when its
// credentials mode matches the request that follows, which matters once
// `base` points at another origin such as a CDN
const tagsFor = (
  styles: string[],
  preloads: string[],
  url: (file: string) => string,
): TagParts => ({
  styles: Array.from(
    new Set(styles),
    (file) => `<link rel="stylesheet" crossorigin href="${url(file)}">`,
  ).join(''),
  preloads: Array.from(
    new Set(preloads),
    (file) => `<link rel="modulepreload" crossorigin href="${url(file)}">`,
  ).join(''),
});

const assetUrl = (base: string) => (file: string) =>
  escapeAttribute(`${base}${file}`);

// CSS files that no chunk lists under `css` or `assets`, such as the single
// style.css of a build with cssCodeSplit off
const unlinkedStyles = (manifest: ViteManifest): string[] => {
  const linked = new Set(
    Object.values(manifest).flatMap((chunk) => [
      ...(chunk.css ?? []),
      ...(chunk.assets ?? []),
    ]),
  );
  return Object.values(manifest)
    .filter(
      (chunk) =>
        chunk.file.endsWith('.css') &&
        !chunk.isEntry &&
        !linked.has(chunk.file),
    )
    .map((chunk) => chunk.file);
};

const entryChunks = (manifest: ViteManifest, entry: string): Set<string> => {
  if (!manifest[entry]) {
    throw new Error(
      `[hono-inertia] "${entry}" is not in the client manifest. Pass the same entry the client build uses.`,
    );
  }
  const chunks = new Set<string>();
  collectChunks(manifest, entry, chunks);
  return chunks;
};

// The tags for the client entry: its CSS and the CSS of every chunk it
// statically imports, modulepreload for those chunks, and the entry script
const entryTagParts = (
  manifest: ViteManifest,
  entry: string,
  base: string,
  cssCodeSplit: boolean,
): TagParts & { script: string } => {
  const chunks = entryChunks(manifest, entry);
  const url = assetUrl(base);
  const parts = tagsFor(
    [
      ...[...chunks].flatMap((key) => manifest[key].css ?? []),
      ...(cssCodeSplit ? [] : unlinkedStyles(manifest)),
    ],
    [...chunks].filter((key) => key !== entry).map((key) => manifest[key].file),
    url,
  );
  return {
    ...parts,
    script: `<script type="module" crossorigin src="${url(manifest[entry].file)}"></script>`,
  };
};

// What a page adds to the entry's tags: the CSS and chunks of the page and its
// static imports that the entry does not load already
const pageTagParts = (
  manifest: ViteManifest,
  entry: string,
  page: string,
  base: string,
): TagParts => {
  const loaded = entryChunks(manifest, entry);
  const loadedStyles = new Set(
    [...loaded].flatMap((key) => manifest[key].css ?? []),
  );
  const chunks = new Set<string>();
  collectChunks(manifest, page, chunks);
  const added = [...chunks].filter((key) => !loaded.has(key));
  return tagsFor(
    added
      .flatMap((key) => manifest[key].css ?? [])
      .filter((file) => !loadedStyles.has(file)),
    added.map((key) => manifest[key].file),
    assetUrl(base),
  );
};

export const renderAssetTags = (
  manifest: ViteManifest,
  entry: string,
  base = '/',
  options: AssetTagOptions = {},
): string => {
  const head = entryTagParts(
    manifest,
    entry,
    base,
    options.cssCodeSplit ?? true,
  );
  const page =
    options.page && manifest[options.page]
      ? pageTagParts(manifest, entry, options.page, base)
      : { styles: '', preloads: '' };
  return `${head.styles}${page.styles}${head.preloads}${page.preloads}${head.script}`;
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
  if (vuePages.length === 0) return { types: [], imports: [], checks: [] };
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
    types: ['VuePage'],
    imports: [
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
// `import type app` for the default export, `import type { name as app }`
// for a named one
const appImport = (serverImport: string, exportName = 'default') => {
  if (exportName === 'default')
    return `import type app from '${serverImport}';`;
  if (!IDENTIFIER.test(exportName)) {
    throw new Error(
      `[hono-inertia] pages.export must be an identifier, got "${exportName}"`,
    );
  }
  return exportName === 'app'
    ? `import type { app } from '${serverImport}';`
    : `import type { ${exportName} as app } from '${serverImport}';`;
};

export const renderPagesFile = (
  pages: PageFile[],
  serverImport: string,
  exportName?: string,
  sharedPageProps = false,
) => {
  const entries = pages.map(
    ({ name }) => `    ${IDENTIFIER.test(name) ? name : `'${name}'`}: true;`,
  );
  const vue = renderVueChecks(pages);
  const packageTypes = [
    ...(sharedPageProps ? ['SharedProps'] : []),
    ...vue.types,
  ];
  return [
    `// Generated by ${PACKAGE_NAME}/vite-plugin from the pages folder. Do not edit.`,
    appImport(serverImport, exportName),
    // One import for the package, which import-x/no-duplicates and the like
    // ask for
    ...(packageTypes.length > 0
      ? [`import type { ${packageTypes.join(', ')} } from '${PACKAGE_NAME}';`]
      : []),
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
    ...(sharedPageProps
      ? [
          '',
          "declare module '@inertiajs/core' {",
          '  interface InertiaConfig {',
          '    sharedPageProps: SharedProps<typeof app>;',
          '  }',
          '}',
        ]
      : []),
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

  const pageName = (file: string): string | null => {
    const relative = normalizePath(path.relative(directory, file));
    const name = options.name
      ? options.name(relative)
      : relative.slice(0, relative.length - path.extname(file).length);
    return name && !exclude.has(name) ? name : null;
  };

  const isPage = (file: string) =>
    file.startsWith(directory + path.sep) &&
    extensions.has(path.extname(file)) &&
    pageName(file) !== null;

  // Every page with its name and absolute path, sorted by name
  const list = async () => {
    const files = await listFiles(directory);
    const pages = files
      .filter((file) => isPage(file))
      .map((file) => ({ name: pageName(file) ?? '', file }))
      .toSorted((a, b) => (a.name < b.name ? -1 : 1));
    for (const [index, page] of pages.entries()) {
      const previous = pages[index - 1];
      if (previous?.name === page.name) {
        throw new Error(
          `[hono-inertia] ${previous.file} and ${page.file} are both named "${page.name}"`,
        );
      }
    }
    return pages;
  };

  const write = async () => {
    const listed = await list();
    const pages = listed.map(({ name, file }) => ({
      name,
      importPath: importPath(file),
    }));
    const contents = renderPagesFile(
      pages,
      serverImport,
      options.export,
      options.sharedPageProps,
    );
    // Rewriting an unchanged file would trigger the watcher and a reload
    const current = await readFile(output, 'utf8').catch(() => '');
    if (current === contents) return;
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, contents);
  };

  return { isPage, list, write };
};

interface AssetsModule {
  version: string;
  assetTags: string;
  manifest: ViteManifest | null;
  // The entry's tags in their three groups, so a page's tags slot in between
  head?: TagParts & { script: string };
  // Page name → what the page adds to the entry's tags
  pages?: Record<string, TagParts>;
}

// The page tags are kept apart from the entry's and joined per call, so the
// server bundle holds the entry's tags once instead of once per page
const assetsModule = ({
  version,
  assetTags,
  manifest,
  head,
  pages = {},
}: AssetsModule): string =>
  [
    `export const version = ${JSON.stringify(version)};`,
    `export const assetTags = ${JSON.stringify(assetTags)};`,
    `export const manifest = ${JSON.stringify(manifest)};`,
    `const head = ${JSON.stringify(head ?? null)};`,
    `const pages = ${JSON.stringify(pages)};`,
    'export const assetTagsFor = (component) => {',
    '  const page = head && Object.hasOwn(pages, component) ? pages[component] : undefined;',
    '  return page ? head.styles + page.styles + head.preloads + page.preloads + head.script : assetTags;',
    '};',
    '',
  ].join('\n');

const PAGE_NAME_PLACEHOLDER = '[name]';
const REGEXP_SPECIAL = /[$()*+.?[\\\]^{|}]/g;

// 'src/pages/[name].vue' → a pattern that captures the name from a manifest
// key such as 'src/pages/Users/Index.vue'. Every later [name] has to repeat
// the first, so 'src/views/[name]/[name].vue' matches 'src/views/Home/Home.vue'.
const pageSourcePattern = (template: string): RegExp => {
  const [first, ...rest] = template.split(PAGE_NAME_PLACEHOLDER);
  if (rest.length === 0) {
    throw new Error(
      `[hono-inertia] pageSource "${template}" must contain ${PAGE_NAME_PLACEHOLDER}`,
    );
  }
  const escape = (part: string) =>
    part.replaceAll(REGEXP_SPECIAL, String.raw`\$&`);
  const [afterFirst, ...others] = rest;
  return new RegExp(
    `^${escape(first)}(.+)${escape(afterFirst)}${others.map((part) => String.raw`\1` + escape(part)).join('')}$`,
  );
};

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
        // Vite serves modules on demand in dev, so there is nothing to preload
        return assetsModule({
          version: 'dev',
          assetTags: `${head}${entry}`,
          manifest: null,
        });
      }

      const contents = await readFile(storePath(), 'utf8').catch(() => {
        this.error(
          `[hono-inertia] No client manifest at ${storePath()}. Build the client before the server.`,
        );
      });
      const manifest = JSON.parse(contents) as ViteManifest;
      const entry = manifestKey(config.root, options.entry);
      // The client environment's setting, also when this is the server build
      const cssCodeSplit =
        config.environments.client?.build.cssCodeSplit ?? true;
      const head = entryTagParts(manifest, entry, config.base, cssCodeSplit);
      // [page name, manifest key] for every page assetTagsFor() knows
      const pageSources = async (): Promise<Array<[string, string]>> => {
        if (pagesFile) {
          const listed = await pagesFile.list();
          return listed.map(({ name, file }) => [
            name,
            manifestKey(config.root, file),
          ]);
        }
        const patterns = [options.pageSource ?? []]
          .flat()
          .map((template) => pageSourcePattern(template));
        return Object.keys(manifest).flatMap((key) => {
          for (const pattern of patterns) {
            const name = pattern.exec(key)?.[1];
            if (name) return [[name, key] as [string, string]];
          }
          return [];
        });
      };

      const sources = await pageSources();
      const pages = Object.fromEntries(
        sources.flatMap(([name, key]) =>
          manifest[key]
            ? [[name, pageTagParts(manifest, entry, key, config.base)]]
            : [],
        ),
      );
      return assetsModule({
        version: versionFromManifest(manifest, options.versionSalt),
        assetTags: `${head.styles}${head.preloads}${head.script}`,
        manifest,
        head,
        pages,
      });
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
