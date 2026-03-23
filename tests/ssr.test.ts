import { afterEach, describe, expect, it, vi } from 'vitest'
import { dispatchToSsr } from '../src/ssr.js'
import type { PageObject } from '../src/types.js'

const mockPage: PageObject = {
  component: 'Test',
  props: { data: 'value' },
  url: '/test',
  version: '1.0',
  encryptHistory: false,
  clearHistory: false,
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('dispatchToSsr', () => {
  it('sends POST to SSR server and returns result', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          head: ['<title>Test</title>', '<meta name="desc" content="x">'],
          body: '<div id="app">rendered</div>',
        }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await dispatchToSsr({ url: 'http://localhost:13714' }, mockPage)

    expect(mockFetch).toHaveBeenCalledWith('http://localhost:13714/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mockPage),
    })
    expect(result).toEqual({
      head: '<title>Test</title>\n<meta name="desc" content="x">',
      body: '<div id="app">rendered</div>',
    })
  })

  it('returns null on HTTP error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    )

    const result = await dispatchToSsr({ url: 'http://localhost:13714' }, mockPage)
    expect(result).toBeNull()
  })

  it('returns null on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    const result = await dispatchToSsr({ url: 'http://localhost:13714' }, mockPage)
    expect(result).toBeNull()
  })

  it('uses default URL when none provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ head: [], body: '' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    await dispatchToSsr({}, mockPage)
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:13714/render',
      expect.any(Object),
    )
  })
})
