import { describe, expect, it } from 'vitest';
import { manifestVersion } from '../src/vite.js';
import type { ViteManifest } from '../src/vite.js';
import { renderAssetTags, versionFromManifest } from '../src/vite-plugin.js';

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
