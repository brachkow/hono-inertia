import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderSsr } from '../src/ssr.js'
import type { PageObject } from '../src/types.js'

const mockPage: PageObject = {
  component: 'Test',
  props: { data: 'value' },
  url: '/test',
  version: '1.0',
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('renderSsr over HTTP', () => {
  it('sends POST to SSR server and returns result', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: () =>
        Promise.resolve({
          head: ['<title>Test</title>', '<meta name="desc" content="x">'],
          body: '<div id="app">rendered</div>',
        }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await renderSsr({ url: 'http://localhost:13714' }, mockPage)

    expect(mockFetch).toHaveBeenCalledWith('http://localhost:13714/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mockPage),
      signal: expect.any(AbortSignal),
    })
    expect(result).toEqual({
      head: '<title>Test</title>\n<meta name="desc" content="x">',
      body: '<div id="app">rendered</div>',
    })
  })

  it('rejects with the SSR server error message and details on HTTP error', async () => {
    const details = { error: 'window is not defined', type: 'browser-api', hint: 'Use onMounted' }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve(details) }),
    )

    const result = renderSsr({ url: 'http://localhost:13714' }, mockPage)

    await expect(result).rejects.toThrow('SSR server responded with 500: window is not defined')
    await expect(result).rejects.toMatchObject({ cause: details })
  })

  it('rejects on HTTP error without a JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 502, json: () => Promise.reject(new SyntaxError()) }),
    )

    await expect(renderSsr({ url: 'http://localhost:13714' }, mockPage)).rejects.toThrow(
      /^SSR server responded with 502$/,
    )
  })

  it('rejects on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    await expect(renderSsr({ url: 'http://localhost:13714' }, mockPage)).rejects.toThrow('ECONNREFUSED')
  })

  it('uses default URL when none provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: () => Promise.resolve({ head: [], body: '' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    await renderSsr({}, mockPage)

    expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:13714/render', expect.any(Object))
  })

  it('rejects when the SSR response shape is invalid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers(),
        json: () => Promise.resolve({ head: 'not-an-array', body: 42 }),
      }),
    )

    await expect(renderSsr({ url: 'http://localhost:13714' }, mockPage)).rejects.toThrow(
      'SSR render must return { head: string[], body: string }',
    )
  })

  it('rejects when the response exceeds maxResponseBytes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'Content-Length': '5000000' }),
        json: () => Promise.resolve({ head: [], body: '' }),
      }),
    )

    await expect(
      renderSsr({ url: 'http://localhost:13714', maxResponseBytes: 1000 }, mockPage),
    ).rejects.toThrow('SSR response exceeds maxResponseBytes (1000)')
  })
})

describe('renderSsr in process', () => {
  it('passes the page to the render function and joins head', async () => {
    const render = vi.fn().mockResolvedValue({
      head: ['<title>Test</title>', '<meta name="desc" content="x">'],
      body: '<div id="app">rendered</div>',
    })

    const result = await renderSsr({ render }, mockPage)

    expect(render).toHaveBeenCalledWith(mockPage)
    expect(result).toEqual({
      head: '<title>Test</title>\n<meta name="desc" content="x">',
      body: '<div id="app">rendered</div>',
    })
  })

  it('accepts a synchronous render function', async () => {
    const result = await renderSsr({ render: () => ({ head: [], body: '<div></div>' }) }, mockPage)

    expect(result).toEqual({ head: '', body: '<div></div>' })
  })

  it('does not call fetch', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    await renderSsr({ render: () => ({ head: [], body: '' }) }, mockPage)

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects with the error the render function throws', async () => {
    const error = new Error('Page not found: Missing')

    await expect(
      renderSsr({ render: () => Promise.reject(error) }, mockPage),
    ).rejects.toBe(error)
  })

  it('rejects when head contains a non-string', async () => {
    await expect(
      renderSsr({ render: () => ({ head: ['<title>x</title>', 42] as unknown as string[], body: '' }) }, mockPage),
    ).rejects.toThrow('SSR render must return { head: string[], body: string }')
  })

  it('rejects when the render function returns nothing', async () => {
    await expect(
      renderSsr({ render: () => undefined as unknown as { head: string[]; body: string } }, mockPage),
    ).rejects.toThrow('SSR render must return { head: string[], body: string }')
  })
})
