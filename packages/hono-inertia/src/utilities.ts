import type { Context } from 'hono';
import type { ResolvedInertiaConfig } from './types.js';

// Without Cache-Control, browsers apply heuristic freshness to the HTML
// document — after a 409-triggered full reload they may serve the same stale
// document again, defeating asset versioning. `no-cache` (not `no-store`,
// which disables bfcache) forces revalidation; `private` because the HTML
// embeds per-user state in data-page.
const DEFAULT_CACHE_CONTROL = 'private, no-cache, must-revalidate';

export function cacheControlValue(
  config: Pick<ResolvedInertiaConfig, 'cacheControl'>,
): string | undefined {
  if (config.cacheControl === false) return undefined;
  return config.cacheControl ?? DEFAULT_CACHE_CONTROL;
}

export const cacheControlHeaders = (
  config: Pick<ResolvedInertiaConfig, 'cacheControl'>,
): Record<string, string> => {
  const cacheControl = cacheControlValue(config);
  return cacheControl === undefined ? {} : { 'Cache-Control': cacheControl };
};

// A 409 the Inertia client answers with a visit: X-Inertia-Location or
// X-Inertia-Redirect
export const conflictResponse = (
  config: Pick<ResolvedInertiaConfig, 'cacheControl'>,
  headers: Record<string, string>,
): Response =>
  new Response(null, {
    status: 409,
    headers: { ...headers, ...cacheControlHeaders(config) },
  });

export function isInertiaRequest(c: Context): boolean {
  return c.req.header('X-Inertia') === 'true';
}

// A comma-separated header or query value, without blanks
export function parseHeaderList(header: string | undefined): Set<string> {
  if (!header) return new Set();
  return new Set(
    header
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

// Sets, so readPartialRequest() checks a prop's few path segments against
// them: an attacker could otherwise send thousands of keys and force a scan
// of all of them per prop on every partial reload
export function getPartialData(c: Context): Set<string> {
  return parseHeaderList(c.req.header('X-Inertia-Partial-Data'));
}

export function getPartialExcept(c: Context): Set<string> {
  return parseHeaderList(c.req.header('X-Inertia-Partial-Except'));
}

export function getPartialComponent(c: Context): string | null {
  return c.req.header('X-Inertia-Partial-Component') ?? null;
}

export function getExceptOnceProperties(c: Context): Set<string> {
  return parseHeaderList(c.req.header('X-Inertia-Except-Once-Props'));
}

export function getErrorBag(c: Context): string | null {
  return c.req.header('X-Inertia-Error-Bag') ?? null;
}

export function getRequestVersion(c: Context): string | null {
  return c.req.header('X-Inertia-Version') ?? null;
}

export function getResetProperties(c: Context): Set<string> {
  return parseHeaderList(c.req.header('X-Inertia-Reset'));
}

export function isPrefetch(c: Context): boolean {
  return c.req.header('Purpose') === 'prefetch';
}

export function getScrollMergeIntent(c: Context): 'append' | 'prepend' {
  const header = c.req.header('X-Inertia-Infinite-Scroll-Merge-Intent');
  return header === 'prepend' ? 'prepend' : 'append';
}

// A Location of `//host/path` or `/\host/path` is protocol-relative, and
// browsers follow it to another origin. Collapsing the leading slashes keeps
// every URL built here on the current origin.
const LEADING_SLASHES = /^[/\\]+/;

const sameOriginPath = (url: URL): string =>
  url.pathname.replace(LEADING_SLASHES, '/');

// Relative to the request URL, without the origin: behind a proxy the
// request's origin can be an internal one
export function toPageUrl(c: Context, url: string): string {
  const resolved = new URL(url, c.req.url);
  return sameOriginPath(resolved) + resolved.search + resolved.hash;
}

export function resolveUrl(c: Context): string {
  const url = new URL(c.req.url);
  return sameOriginPath(url) + url.search;
}
