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
    css: ['assets/Settings-Lm9nOp0Q.css'],
  },
};

describe('renderAssetTags', () => {
  it('links the entry script', () => {
    const tags = renderAssetTags(manifest, 'src/client.ts');

    expect(tags).toContain(
      '<script type="module" src="/assets/client-B2xL9qKd.js"></script>',
    );
  });

  it('includes CSS from the entry and every chunk it statically imports', () => {
    const tags = renderAssetTags(manifest, 'src/client.ts');

    expect(tags).toContain(
      '<link rel="stylesheet" href="/assets/client-Cq1zR8pW.css">',
    );
    expect(tags).toContain(
      '<link rel="stylesheet" href="/assets/vendor-Xy7pQ2rS.css">',
    );
  });

  it('preloads imported chunks, following import cycles once', () => {
    const tags = renderAssetTags(manifest, 'src/client.ts');

    expect(tags.match(/rel="modulepreload"/g)).toHaveLength(2);
    expect(tags).toContain(
      '<link rel="modulepreload" href="/assets/vendor-DkT3mNfA.js">',
    );
    expect(tags).toContain(
      '<link rel="modulepreload" href="/assets/shared-Ab12Cd34.js">',
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

  it('throws when the entry is not in the manifest', () => {
    expect(() => renderAssetTags(manifest, 'src/main.ts')).toThrow(
      '"src/main.ts" is not in the client manifest',
    );
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
