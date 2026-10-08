import type { PageObject, SsrConfig, SsrHttpConfig, SsrResult } from './types.js'

const DEFAULT_SSR_URL = 'http://127.0.0.1:13714'
const DEFAULT_SSR_TIMEOUT = 5000
const DEFAULT_SSR_MAX_RESPONSE_BYTES = 2_000_000

// Rejects on any failure; the caller reports it and falls back to CSR.
export async function renderSsr(config: SsrConfig, page: PageObject): Promise<SsrResult> {
  if (config.render) {
    return toSsrResult(await config.render(page))
  }
  return dispatchToSsr(config, page)
}

async function dispatchToSsr(config: SsrHttpConfig, page: PageObject): Promise<SsrResult> {
  const url = config.url ?? DEFAULT_SSR_URL

  const response = await fetch(`${url}/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(page),
    // Without a timeout a hung SSR server holds the request open indefinitely.
    signal: AbortSignal.timeout(config.timeout ?? DEFAULT_SSR_TIMEOUT),
  })

  if (!response.ok) {
    // Inertia's SSR server answers failures with a classified error
    // ({ error, type, hint, stack, ... }); keep it as the cause.
    const details: unknown = await response.json().catch(() => undefined)
    const message = (details as { error?: unknown } | undefined)?.error
    throw new Error(
      `SSR server responded with ${response.status}${typeof message === 'string' ? `: ${message}` : ''}`,
      { cause: details },
    )
  }

  // Reject oversized bodies before buffering them into the heap.
  const maxBytes = config.maxResponseBytes ?? DEFAULT_SSR_MAX_RESPONSE_BYTES
  if (Number(response.headers.get('Content-Length')) > maxBytes) {
    throw new Error(`SSR response exceeds maxResponseBytes (${maxBytes})`)
  }

  return toSsrResult(await response.json())
}

// The SSR server is a trust boundary, and an in-process entry can return
// anything; validate the shape before handing head/body to the render function.
const toSsrResult = (result: unknown): SsrResult => {
  const { head, body } = (result ?? {}) as { head?: unknown; body?: unknown }
  if (
    !Array.isArray(head) ||
    !head.every((tag) => typeof tag === 'string') ||
    typeof body !== 'string'
  ) {
    throw new Error('SSR render must return { head: string[], body: string }')
  }
  return { head: head.join('\n'), body }
}
