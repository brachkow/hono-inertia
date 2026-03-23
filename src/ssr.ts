import type { PageObject, SsrConfig, SsrResult } from './types.js'

export async function dispatchToSsr(
  config: SsrConfig,
  page: PageObject,
): Promise<SsrResult | null> {
  const url = config.url ?? 'http://127.0.0.1:13714'

  try {
    const response = await fetch(`${url}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(page),
    })

    if (!response.ok) {
      return null
    }

    const result = (await response.json()) as {
      head: string[]
      body: string
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
