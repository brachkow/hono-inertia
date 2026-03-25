import type { Context } from 'hono'

export function isInertiaRequest(c: Context): boolean {
  return c.req.header('X-Inertia') === 'true'
}

export function getPartialData(c: Context): string[] {
  const header = c.req.header('X-Inertia-Partial-Data')
  return header ? header.split(',').map((s) => s.trim()).filter(Boolean) : []
}

export function getPartialExcept(c: Context): string[] {
  const header = c.req.header('X-Inertia-Partial-Except')
  return header ? header.split(',').map((s) => s.trim()).filter(Boolean) : []
}

export function getPartialComponent(c: Context): string | null {
  return c.req.header('X-Inertia-Partial-Component') ?? null
}

export function getExceptOnceProps(c: Context): string[] {
  const header = c.req.header('X-Inertia-Except-Once-Props')
  return header ? header.split(',').map((s) => s.trim()).filter(Boolean) : []
}

export function getErrorBag(c: Context): string | null {
  return c.req.header('X-Inertia-Error-Bag') ?? null
}

export function getRequestVersion(c: Context): string | null {
  return c.req.header('X-Inertia-Version') ?? null
}

export function getResetProps(c: Context): string[] {
  const header = c.req.header('X-Inertia-Reset')
  return header ? header.split(',').map((s) => s.trim()).filter(Boolean) : []
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
