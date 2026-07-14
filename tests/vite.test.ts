import { describe, expect, it } from 'vitest'
import { manifestVersion } from '../src/vite.js'
import type { ViteManifest } from '../src/vite.js'

const manifest: ViteManifest = {
  'src/main.ts': {
    file: 'assets/main-B2xL9qKd.js',
    css: ['assets/main-Cq1zR8pW.css'],
    imports: ['_vendor-DkT3mNfA.js'],
  },
  '_vendor-DkT3mNfA.js': {
    file: 'assets/vendor-DkT3mNfA.js',
  },
  'src/pages/Settings.vue': {
    file: 'assets/Settings-atoOrKTF.js',
    imports: ['_vendor-DkT3mNfA.js'],
  },
}

describe('manifestVersion', () => {
  it('produces a 16-character lowercase hex string', async () => {
    const version = await manifestVersion(manifest)()

    expect(version).toMatch(/^[0-9a-f]{16}$/)
  })

  it('memoizes: repeated calls return the same promise and value', async () => {
    const thunk = manifestVersion(manifest)

    const first = thunk()
    const second = thunk()

    expect(second).toBe(first)
    expect(await second).toBe(await first)
  })

  it('is insensitive to manifest key order', async () => {
    const reordered = Object.fromEntries(Object.entries(manifest).reverse())

    const original = await manifestVersion(manifest)()
    const shuffled = await manifestVersion(reordered)()

    expect(shuffled).toBe(original)
  })

  it('is insensitive to metadata churn when file hashes are unchanged', async () => {
    const withChurn: ViteManifest = {
      ...manifest,
      'src/main.ts': {
        ...manifest['src/main.ts'],
        css: ['assets/main-Zz9zZz9z.css'],
        imports: [],
      },
    }

    const original = await manifestVersion(manifest)()
    const churned = await manifestVersion(withChurn)()

    expect(churned).toBe(original)
  })

  it('changes when an emitted file hash changes', async () => {
    const rebuilt: ViteManifest = {
      ...manifest,
      'src/pages/Settings.vue': {
        ...manifest['src/pages/Settings.vue'],
        file: 'assets/Settings-Xy7wQ2rM.js',
      },
    }

    const original = await manifestVersion(manifest)()
    const changed = await manifestVersion(rebuilt)()

    expect(changed).not.toBe(original)
  })

  it('changes when the salt changes', async () => {
    const unsalted = await manifestVersion(manifest)()
    const salted = await manifestVersion(manifest, 'deploy-2')()

    expect(salted).not.toBe(unsalted)
  })
})
