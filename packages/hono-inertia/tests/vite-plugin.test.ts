import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BuildEnvironment, ResolvedConfig, ViteBuilder } from 'vite';
import { describe, expect, it } from 'vitest';
import { manifestVersion } from '../src/vite.js';
import type { ViteManifest } from '../src/vite.js';
import {
  honoInertia,
  manifestKey,
  renderAssetTags,
  versionFromManifest,
} from '../src/vite-plugin.js';

const FOLDER_PAGE = /^([^/]+)\/\1\.vue$/;

const manifest: ViteManifest = {
  'src/client.ts': {
    file: 'assets/client-B2xL9qKd.js',
    css: ['assets/client-Cq1zR8pW.css'],
    imports: ['_vendor-DkT3mNfA.js'],
  },
  '_vendor-DkT3mNfA.js': {
    file: 'assets/vendor-DkT3mNfA.js',
    css: ['assets/vendor-Xy7pQ2rS.css'],
    imports: ['_shared-Ab12Cd34.js'],
  },
  '_shared-Ab12Cd34.js': {
    file: 'assets/shared-Ab12Cd34.js',
    imports: ['_vendor-DkT3mNfA.js'],
  },
  'src/pages/Settings.vue': {
    file: 'assets/Settings-atoOrKTF.js',
    isDynamicEntry: true,
    css: ['assets/Settings-Lm9nOp0Q.css'],
    imports: ['_vendor-DkT3mNfA.js', '_form-Qw8eRt5y.js'],
  },
  '_form-Qw8eRt5y.js': {
    file: 'assets/form-Qw8eRt5y.js',
    css: ['assets/form-Zx3cVb6n.css', 'assets/vendor-Xy7pQ2rS.css'],
  },
};

// What Vite writes with build.cssCodeSplit: false. No chunk lists the CSS.
const singleCssManifest: ViteManifest = {
  'src/client.ts': {
    file: 'assets/client-DW7c_mi_.js',
    isEntry: true,
    dynamicImports: ['src/pages/Home.vue'],
  },
  'src/pages/Home.vue': {
    file: 'assets/Home-DgF8xpXQ.js',
    isDynamicEntry: true,
  },
  'style.css': { file: 'assets/style-CYnB7E3U.css', src: 'style.css' },
};

describe('renderAssetTags', () => {
  it('links the entry script', () => {
    const tags = renderAssetTags(manifest, 'src/client.ts');

    expect(tags).toContain(
      '<script type="module" crossorigin src="/assets/client-B2xL9qKd.js"></script>',
    );
  });

  it('includes CSS from the entry and every chunk it statically imports', () => {
    const tags = renderAssetTags(manifest, 'src/client.ts');

    expect(tags).toContain(
      '<link rel="stylesheet" crossorigin href="/assets/client-Cq1zR8pW.css">',
    );
    expect(tags).toContain(
      '<link rel="stylesheet" crossorigin href="/assets/vendor-Xy7pQ2rS.css">',
    );
  });

  it('preloads imported chunks, following import cycles once', () => {
    const tags = renderAssetTags(manifest, 'src/client.ts');

    expect(tags.match(/rel="modulepreload"/g)).toHaveLength(2);
    expect(tags).toContain(
      '<link rel="modulepreload" crossorigin href="/assets/vendor-DkT3mNfA.js">',
    );
    expect(tags).toContain(
      '<link rel="modulepreload" crossorigin href="/assets/shared-Ab12Cd34.js">',
    );
  });

  it('leaves out lazily loaded pages', () => {
    const tags = renderAssetTags(manifest, 'src/client.ts');

    expect(tags).not.toContain('Settings');
  });

  it('puts styles before the entry script', () => {
    const tags = renderAssetTags(manifest, 'src/client.ts');

    expect(tags.indexOf('stylesheet')).toBeLessThan(tags.indexOf('<script'));
  });

  it('prefixes URLs with the Vite base', () => {
    const tags = renderAssetTags(manifest, 'src/client.ts', '/app/');

    expect(tags).toContain('src="/app/assets/client-B2xL9qKd.js"');
  });

  it('escapes quotes in URLs', () => {
    const tags = renderAssetTags(manifest, 'src/client.ts', '/a"b/');

    expect(tags).toContain('src="/a&quot;b/assets/client-B2xL9qKd.js"');
  });

  it('sets crossorigin on every tag, as Vite does', () => {
    const tags = renderAssetTags(manifest, 'src/client.ts');

    expect(tags.match(/<(link|script) /g)).toHaveLength(
      tags.match(/ crossorigin /g)?.length ?? 0,
    );
  });

  it('links the single CSS file of a build without CSS code splitting', () => {
    const tags = renderAssetTags(singleCssManifest, 'src/client.ts', '/', {
      cssCodeSplit: false,
    });

    expect(tags).toContain(
      '<link rel="stylesheet" crossorigin href="/assets/style-CYnB7E3U.css">',
    );
  });

  it('leaves unlinked CSS out when CSS code splitting is on', () => {
    const tags = renderAssetTags(singleCssManifest, 'src/client.ts');

    expect(tags).not.toContain('style-CYnB7E3U.css');
  });

  it('does not link a CSS file that a chunk lists as an asset', () => {
    const tags = renderAssetTags(
      {
        ...singleCssManifest,
        'src/client.ts': {
          ...singleCssManifest['src/client.ts'],
          assets: ['assets/style-CYnB7E3U.css'],
        },
      },
      'src/client.ts',
      '/',
      { cssCodeSplit: false },
    );

    expect(tags).not.toContain('stylesheet');
  });

  it('throws when the entry is not in the manifest', () => {
    expect(() => renderAssetTags(manifest, 'src/main.ts')).toThrow(
      '"src/main.ts" is not in the client manifest',
    );
  });
});

describe('renderAssetTags with a page', () => {
  const pageTags = () =>
    renderAssetTags(manifest, 'src/client.ts', '/', {
      page: 'src/pages/Settings.vue',
    });

  it("preloads the page's chunk and the chunks it imports", () => {
    const tags = pageTags();

    expect(tags).toContain(
      '<link rel="modulepreload" crossorigin href="/assets/Settings-atoOrKTF.js">',
    );
    expect(tags).toContain(
      '<link rel="modulepreload" crossorigin href="/assets/form-Qw8eRt5y.js">',
    );
  });

  it("links the page's CSS", () => {
    const tags = pageTags();

    expect(tags).toContain('href="/assets/Settings-Lm9nOp0Q.css"');
    expect(tags).toContain('href="/assets/form-Zx3cVb6n.css"');
  });

  it('adds nothing the entry already loads', () => {
    const tags = pageTags();

    expect(tags.match(/vendor-DkT3mNfA\.js/g)).toHaveLength(1);
    expect(tags.match(/vendor-Xy7pQ2rS\.css/g)).toHaveLength(1);
  });

  it('keeps styles first and the entry script last', () => {
    const tags = pageTags();

    expect(tags.lastIndexOf('stylesheet')).toBeLessThan(
      tags.indexOf('modulepreload'),
    );
    expect(tags.endsWith('</script>')).toBe(true);
  });

  it('returns the entry tags for a page that is not in the manifest', () => {
    const tags = renderAssetTags(manifest, 'src/client.ts', '/', {
      page: 'src/pages/Missing.vue',
    });

    expect(tags).toBe(renderAssetTags(manifest, 'src/client.ts'));
  });
});

describe('versionFromManifest', () => {
  it('matches what manifestVersion computes at runtime', async () => {
    expect(versionFromManifest(manifest)).toBe(
      await manifestVersion(manifest)(),
    );
  });

  it('matches manifestVersion with a salt', async () => {
    expect(versionFromManifest(manifest, 'v2')).toBe(
      await manifestVersion(manifest, 'v2')(),
    );
  });

  it('changes with the salt', () => {
    expect(versionFromManifest(manifest, 'v2')).not.toBe(
      versionFromManifest(manifest),
    );
  });
});

describe('manifestKey', () => {
  it('keeps a root-relative entry as is', () => {
    expect(manifestKey('/app', 'src/client.ts')).toBe('src/client.ts');
  });

  it('drops a leading ./', () => {
    expect(manifestKey('/app', './src/client.ts')).toBe('src/client.ts');
  });

  it('makes an absolute entry relative to the root', () => {
    expect(manifestKey('/app', '/app/src/client.ts')).toBe('src/client.ts');
  });
});

describe('pages', () => {
  const createProject = async (files: string[]) => {
    const root = await mkdtemp(path.join(tmpdir(), 'hono-inertia-pages-'));
    for (const file of files) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), '');
    }
    return root;
  };

  const generate = async (
    root: string,
    pages: Parameters<typeof honoInertia>[0]['pages'],
  ) => {
    const [plugin] = honoInertia({ entry: 'src/client.ts', pages });
    const hook = plugin.configResolved;
    if (typeof hook !== 'function') throw new TypeError('no configResolved');
    // Only root is read
    await hook.call(undefined as never, { root } as ResolvedConfig);
  };

  it('checks that every Vue page declares the props its routes pass', async () => {
    const root = await createProject([
      'src/pages/Home.vue',
      'src/pages/Users/Index.vue',
      'src/pages/About.tsx',
    ]);

    await generate(root, { directory: 'src/pages', server: 'src/server.ts' });

    const generated = await readFile(
      path.join(root, 'src/pages.gen.ts'),
      'utf8',
    );
    expect(generated).toContain(
      "import type HomePage from './pages/Home.vue';\nimport type UsersIndexPage from './pages/Users/Index.vue';\n",
    );
    expect(generated).toContain(
      "export type VuePages = [\n  VuePage<'Home', typeof HomePage>,\n  VuePage<'Users/Index', typeof UsersIndexPage>,\n];\n",
    );
  });

  it('adds no Vue checks without Vue pages', async () => {
    const root = await createProject(['src/pages/Home.tsx']);

    await generate(root, { directory: 'src/pages', server: 'src/server.ts' });

    const generated = await readFile(
      path.join(root, 'src/pages.gen.ts'),
      'utf8',
    );
    expect(generated).not.toContain('VuePage');
  });

  it('lists every page by its path in the folder, sorted', async () => {
    const root = await createProject([
      'src/pages/Users/Index.tsx',
      'src/pages/Home.tsx',
      'src/pages/Users/Show.tsx',
    ]);

    await generate(root, { directory: 'src/pages', server: 'src/server.ts' });

    const generated = await readFile(
      path.join(root, 'src/pages.gen.ts'),
      'utf8',
    );
    expect(generated).toContain(
      "    Home: true;\n    'Users/Index': true;\n    'Users/Show': true;\n",
    );
  });

  it('imports the app type relative to the generated file', async () => {
    const root = await createProject(['app/pages/Home.vue']);

    await generate(root, {
      directory: 'app/pages',
      server: 'app/worker.ts',
      output: 'types/pages.gen.ts',
    });

    const generated = await readFile(
      path.join(root, 'types/pages.gen.ts'),
      'utf8',
    );
    expect(generated).toContain("import type app from '../app/worker';");
  });

  it('skips other extensions and excluded pages', async () => {
    const root = await createProject([
      'src/pages/Home.vue',
      'src/pages/Layout.vue',
      'src/pages/helpers.ts',
      'src/pages/styles.css',
    ]);

    await generate(root, {
      directory: 'src/pages',
      server: 'src/server.ts',
      exclude: ['Layout'],
    });

    const generated = await readFile(
      path.join(root, 'src/pages.gen.ts'),
      'utf8',
    );
    expect(generated).toContain(
      '  interface InertiaPages {\n    Home: true;\n  }',
    );
  });

  it('names pages with the name option and skips files it returns null for', async () => {
    const root = await createProject([
      'src/views/Landing/Landing.vue',
      'src/views/Landing/components/HeroSection.vue',
      'src/views/Settings/Settings.vue',
    ]);

    await generate(root, {
      directory: 'src/views',
      server: 'src/server.ts',
      name: (relativePath) => FOLDER_PAGE.exec(relativePath)?.[1] ?? null,
    });

    const generated = await readFile(
      path.join(root, 'src/views.gen.ts'),
      'utf8',
    );
    expect(generated).toContain(
      '  interface InertiaPages {\n    Landing: true;\n    Settings: true;\n  }',
    );
    expect(generated).toContain(
      "import type LandingPage from './views/Landing/Landing.vue';",
    );
  });

  it('fails when two files get the same name', async () => {
    const root = await createProject([
      'src/pages/Home.vue',
      'src/pages/Home.tsx',
    ]);

    await expect(
      generate(root, {
        directory: 'src/pages',
        server: 'src/server.ts',
        name: () => 'Home',
      }),
    ).rejects.toThrow('are both named "Home"');
  });

  it('imports a named export as the app', async () => {
    const root = await createProject(['src/pages/Home.tsx']);

    await generate(root, {
      directory: 'src/pages',
      server: 'src/worker.ts',
      export: 'app',
    });

    const generated = await readFile(
      path.join(root, 'src/pages.gen.ts'),
      'utf8',
    );
    expect(generated).toContain("import type { app } from './worker';");
  });

  it('renames another named export to app', async () => {
    const root = await createProject(['src/pages/Home.tsx']);

    await generate(root, {
      directory: 'src/pages',
      server: 'src/worker.ts',
      export: 'honoApp',
    });

    const generated = await readFile(
      path.join(root, 'src/pages.gen.ts'),
      'utf8',
    );
    expect(generated).toContain(
      "import type { honoApp as app } from './worker';",
    );
  });

  it('declares the shared props for the client with sharedPageProps', async () => {
    const root = await createProject(['src/pages/Home.tsx']);

    await generate(root, {
      directory: 'src/pages',
      server: 'src/server.ts',
      sharedPageProps: true,
    });

    const generated = await readFile(
      path.join(root, 'src/pages.gen.ts'),
      'utf8',
    );
    expect(generated).toContain(
      "import type { SharedProps } from '@brachkow/hono-inertia';",
    );
    expect(generated).toContain(
      "declare module '@inertiajs/core' {\n  interface InertiaConfig {\n    sharedPageProps: SharedProps<typeof app>;\n  }\n}",
    );
  });

  it('leaves the client types alone by default', async () => {
    const root = await createProject(['src/pages/Home.tsx']);

    await generate(root, { directory: 'src/pages', server: 'src/server.ts' });

    const generated = await readFile(
      path.join(root, 'src/pages.gen.ts'),
      'utf8',
    );
    expect(generated).not.toContain('@inertiajs/core');
  });

  it('registers the app and re-exports PageProps', async () => {
    const root = await createProject(['src/pages/Home.tsx']);

    await generate(root, { directory: 'src/pages', server: 'src/server.ts' });

    const generated = await readFile(
      path.join(root, 'src/pages.gen.ts'),
      'utf8',
    );
    expect(generated).toContain("import type app from './server';");
    expect(generated).toContain('    app: typeof app;');
    expect(generated).toContain(
      "export type { PageProps } from '@brachkow/hono-inertia';",
    );
  });
});

describe('honoInertia build order', () => {
  // A builder with the named environments, recording the order it builds them
  const createBuilder = (names: string[]) => {
    const built: string[] = [];
    const environments = Object.fromEntries(
      names.map((name) => [name, { name, isBuilt: false } as BuildEnvironment]),
    );
    const builder = {
      environments,
      build: (environment: BuildEnvironment) => {
        built.push(environment.name);
        environment.isBuilt = true;
        return Promise.resolve();
      },
    } as unknown as ViteBuilder;
    return { builder, built };
  };

  // Runs the plugins' buildApp hooks the way Vite does: pre hooks, then the
  // config's buildApp, then post hooks
  const buildApp = async (
    builder: ViteBuilder,
    configBuildApp: (builder: ViteBuilder) => Promise<void> = () =>
      Promise.resolve(),
  ) => {
    const hooks = honoInertia({ entry: 'src/client.ts' }).flatMap((plugin) =>
      plugin.buildApp && typeof plugin.buildApp === 'object'
        ? [plugin.buildApp]
        : [],
    );
    const run = (order: 'pre' | 'post') =>
      Promise.all(
        hooks
          .filter((hook) => hook.order === order)
          .map((hook) => hook.handler.call(undefined as never, builder)),
      );
    await run('pre');
    await configBuildApp(builder);
    await run('post');
  };

  it('builds the client before the server', async () => {
    const { builder, built } = createBuilder(['ssr', 'client']);

    await buildApp(builder);

    expect(built).toEqual(['client', 'ssr']);
  });

  it('leaves the rest to a config buildApp that builds the server', async () => {
    // Like @cloudflare/vite-plugin's default, which builds the Worker and then
    // the client again
    const { builder, built } = createBuilder(['client', 'worker']);
    const configBuildApp = async (configured: ViteBuilder) => {
      await configured.build(configured.environments.worker);
      await configured.build(configured.environments.client);
    };

    await buildApp(builder, configBuildApp);

    expect(built).toEqual(['client', 'worker', 'client']);
  });

  it('builds a lone environment once', async () => {
    const { builder, built } = createBuilder(['ssr']);

    await buildApp(builder);

    expect(built).toEqual(['ssr']);
  });
});

describe('honoInertia server bundle check', () => {
  const ASSETS = '\0virtual:hono-inertia/assets';

  // Runs the plugin's generateBundle on one chunk of the named environment
  const generate = (
    environment: string,
    chunk: { moduleIds: string[]; imports?: string[] },
  ) => {
    const [plugin] = honoInertia({ entry: 'src/client.ts' });
    const hook = plugin.generateBundle;
    if (typeof hook !== 'function') throw new TypeError('no generateBundle');
    const context = {
      environment: { name: environment },
      error: (message: string) => {
        throw new Error(message);
      },
    };
    const bundle = {
      'main.js': {
        type: 'chunk',
        imports: [],
        dynamicImports: [],
        ...chunk,
      },
    };
    return () =>
      hook.call(context as never, {} as never, bundle as never, false);
  };

  it("fails a server that uses the asset tags and imports Inertia's SSR server", () => {
    const build = generate('ssr', {
      moduleIds: ['/app/src/main.ts', ASSETS],
      imports: ['@inertiajs/react/server'],
    });

    expect(build).toThrow('@inertiajs/react/server');
  });

  it('fails when the SSR server is bundled into a Worker', () => {
    const build = generate('worker', {
      moduleIds: [ASSETS, '/app/node_modules/@inertiajs/vue3/dist/server.js'],
    });

    expect(build).toThrow('ssr: false');
  });

  it('passes a server that only renders in-process', () => {
    const build = generate('ssr', {
      moduleIds: ['/app/src/main.ts', '/app/src/ssr.ts', ASSETS],
      imports: ['@inertiajs/react', 'react-dom/server'],
    });

    expect(build).not.toThrow();
  });

  it('passes an Inertia SSR server built without the asset tags', () => {
    const build = generate('ssr', {
      moduleIds: ['/app/src/ssr.ts'],
      imports: ['@inertiajs/react/server'],
    });

    expect(build).not.toThrow();
  });

  it('ignores the client build', () => {
    const build = generate('client', {
      moduleIds: [ASSETS, '/app/node_modules/@inertiajs/vue3/dist/server.js'],
    });

    expect(build).not.toThrow();
  });
});

describe('virtual assets module', () => {
  // The client build's manifest as the plugin stores it, plus page files
  const createBuild = async (
    buildManifest: ViteManifest,
    files: string[] = [],
  ) => {
    const root = await mkdtemp(path.join(tmpdir(), 'hono-inertia-assets-'));
    const store = path.join(root, 'node_modules/.hono-inertia');
    await mkdir(store, { recursive: true });
    await writeFile(
      path.join(store, 'manifest.json'),
      JSON.stringify(buildManifest),
    );
    for (const file of files) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), '');
    }
    return root;
  };

  // Runs the plugin's configResolved and load hooks, then imports the code
  const loadModule = async (
    root: string,
    options: Partial<Parameters<typeof honoInertia>[0]> = {},
    cssCodeSplit = true,
  ) => {
    const [plugin] = honoInertia({ entry: 'src/client.ts', ...options });
    const configResolved = plugin.configResolved;
    const load = plugin.load;
    if (typeof configResolved !== 'function' || typeof load !== 'function') {
      throw new TypeError('no hooks');
    }
    await configResolved.call(
      undefined as never,
      {
        root,
        base: '/',
        environments: { client: { build: { cssCodeSplit } } },
      } as unknown as ResolvedConfig,
    );
    const code = (await load.call(
      {
        error: (message: string) => {
          throw new Error(message);
        },
      } as never,
      '\0virtual:hono-inertia/assets',
    )) as string;
    return (await import(
      `data:text/javascript,${encodeURIComponent(code)}`
    )) as {
      assetTags: string;
      assetTagsFor: (component: string) => string;
      manifest: ViteManifest | null;
    };
  };

  it('exports the manifest', async () => {
    const root = await createBuild(manifest);

    const assets = await loadModule(root);

    expect(assets.manifest).toEqual(manifest);
  });

  it("adds a page's tags for a page from the pages folder", async () => {
    const root = await createBuild(manifest, ['src/pages/Settings.vue']);

    const assets = await loadModule(root, {
      pages: { directory: 'src/pages', server: 'src/server.ts' },
    });

    expect(assets.assetTagsFor('Settings')).toBe(
      renderAssetTags(manifest, 'src/client.ts', '/', {
        page: 'src/pages/Settings.vue',
      }),
    );
  });

  it('finds pages with a pageSource pattern', async () => {
    const root = await createBuild(manifest);

    const assets = await loadModule(root, {
      pageSource: 'src/pages/[name].vue',
    });

    expect(assets.assetTagsFor('Settings')).toContain('Settings-atoOrKTF.js');
  });

  it('matches a pageSource that repeats [name]', async () => {
    const root = await createBuild({
      ...manifest,
      'src/views/Landing/Landing.vue': {
        file: 'assets/Landing-Hj4kL5mN.js',
        isDynamicEntry: true,
      },
      'src/views/Landing/Other.vue': {
        file: 'assets/Other-Pq6rS7tU.js',
        isDynamicEntry: true,
      },
    });

    const assets = await loadModule(root, {
      pageSource: 'src/views/[name]/[name].vue',
    });

    expect(assets.assetTagsFor('Landing')).toContain('Landing-Hj4kL5mN.js');
    expect(assets.assetTagsFor('Landing')).not.toContain('Other-Pq6rS7tU.js');
  });

  it('returns the entry tags for a page it does not know', async () => {
    const root = await createBuild(manifest);

    const assets = await loadModule(root, {
      pageSource: 'src/pages/[name].vue',
    });

    expect(assets.assetTagsFor('Missing')).toBe(assets.assetTags);
    expect(assets.assetTagsFor('constructor')).toBe(assets.assetTags);
  });

  it('returns the entry tags without pages or pageSource', async () => {
    const root = await createBuild(manifest);

    const assets = await loadModule(root);

    expect(assets.assetTagsFor('Settings')).toBe(assets.assetTags);
  });

  it("links the single CSS file when the client build doesn't split CSS", async () => {
    const root = await createBuild(singleCssManifest);

    const assets = await loadModule(root, {}, false);

    expect(assets.assetTags).toContain('href="/assets/style-CYnB7E3U.css"');
  });

  it('rejects a pageSource without [name]', async () => {
    const root = await createBuild(manifest);

    await expect(
      loadModule(root, { pageSource: 'src/pages/Home.vue' }),
    ).rejects.toThrow('must contain [name]');
  });
});
