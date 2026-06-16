import type { PageObject, SsrConfig, SsrResult } from './types.js'

const DEFAULT_SSR_URL = 'http://127.0.0.1:13714'
const DEFAULT_SSR_TIMEOUT = 5000
const DEFAULT_SSR_MAX_RESPONSE_BYTES = 2_000_000

export async function dispatchToSsr(
  config: SsrConfig,
  page: PageObject,
): Promise<SsrResult | null> {
  const url = config.url ?? DEFAULT_SSR_URL

  try {
    const response = await fetch(`${url}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(page),
      // Without a timeout a hung SSR server holds the request open indefinitely
      // (the catch below never fires on a hang). Bound it and fall back to CSR.
      signal: AbortSignal.timeout(config.timeout ?? DEFAULT_SSR_TIMEOUT),
    })

    if (!response.ok) {
      return null
    }

    // Reject oversized bodies before buffering them into the heap.
    const maxBytes = config.maxResponseBytes ?? DEFAULT_SSR_MAX_RESPONSE_BYTES
    if (Number(response.headers.get('Content-Length')) > maxBytes) {
      return null
    }

    // The SSR server is a trust boundary; validate the response shape before
    // handing head/body to the render function.
    const result = (await response.json()) as { head?: unknown; body?: unknown }
    if (!Array.isArray(result.head) || typeof result.body !== 'string') {
      return null
    }

    return {
      head: result.head.join('\n'),
      body: result.body,
    }
  } catch {
    // Graceful degradation: fall back to client-side rendering
    return null
  }
}
