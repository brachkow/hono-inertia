import type { Context } from 'hono'

export function isInertiaRequest(c: Context): boolean {
  return c.req.header('X-Inertia') === 'true'
}

function parseHeaderList(header: string | undefined): Set<string> {
  if (!header) return new Set()
  return new Set(header.split(',').map((s) => s.trim()).filter(Boolean))
}

// Returned as a Set so membership checks in response.ts are O(1) — an attacker
// could otherwise send thousands of comma-separated keys and force O(n) scans
// per prop on every partial reload.
export function getPartialData(c: Context): Set<string> {
  return parseHeaderList(c.req.header('X-Inertia-Partial-Data'))
}

export function getPartialExcept(c: Context): Set<string> {
  return parseHeaderList(c.req.header('X-Inertia-Partial-Except'))
}

export function getPartialComponent(c: Context): string | null {
  return c.req.header('X-Inertia-Partial-Component') ?? null
}

export function getExceptOnceProps(c: Context): Set<string> {
  return parseHeaderList(c.req.header('X-Inertia-Except-Once-Props'))
}

export function getErrorBag(c: Context): string | null {
  return c.req.header('X-Inertia-Error-Bag') ?? null
}

export function getRequestVersion(c: Context): string | null {
  return c.req.header('X-Inertia-Version') ?? null
}

export function getResetProps(c: Context): Set<string> {
  return parseHeaderList(c.req.header('X-Inertia-Reset'))
}

export function isPrefetch(c: Context): boolean {
  return c.req.header('Purpose') === 'prefetch'
}

export function getScrollMergeIntent(c: Context): 'append' | 'prepend' {
  const header = c.req.header('X-Inertia-Infinite-Scroll-Merge-Intent')
  return header === 'prepend' ? 'prepend' : 'append'
}

export function resolveUrl(c: Context): string {
  const url = new URL(c.req.url)
  return url.pathname + url.search
}
