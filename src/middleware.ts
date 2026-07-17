import { createMiddleware } from 'hono/factory'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { MiddlewareHandler } from 'hono'
import type { InertiaConfig, InertiaEnv } from './types.js'
import { InertiaResponse } from './response.js'
import { cacheControlValue, getRequestVersion, isInertiaRequest, isPrefetch, resolveUrl } from './utils.js'

export const CLEAR_HISTORY_COOKIE = 'inertia_clear_history'

const REDIRECT_STATUSES = [301, 302, 303, 307, 308]

// clearHistory only lands on a rendered page object, but logout handlers
// redirect. Laravel flashes the flag via session; this adapter is stateless,
// so the redirect target inherits it through a short-lived cookie instead.
const isRedirectShaped = (res: Response): boolean =>
  REDIRECT_STATUSES.includes(res.status) ||
  (res.status === 409 &&
    (res.headers.has('X-Inertia-Redirect') || res.headers.has('X-Inertia-Location')))

export function inertia(config: InertiaConfig): MiddlewareHandler<InertiaEnv> {
  return createMiddleware<InertiaEnv>(async (c, next) => {
    // Current asset version, resolved lazily and at most once per request —
    // a version thunk must not run on passthrough routes or POSTs that never
    // need it. Not cached across requests: a thunk may intentionally be live.
    let resolved: Promise<string | null> | undefined
    const currentVersion = (): Promise<string | null> => {
      resolved ??=
        config.version === undefined
          ? Promise.resolve(null)
          : Promise.resolve(
              typeof config.version === 'function'
                ? config.version()
                : config.version,
            )
      return resolved
    }

    // Version conflict check (before handler, GET only). A missing or empty
    // X-Inertia-Version never 409s, and a null server version means
    // versioning is disabled — both per Inertia protocol (matches Laravel).
    if (
      isInertiaRequest(c) &&
      c.req.method === 'GET'
    ) {
      const clientVersion = getRequestVersion(c)
      if (clientVersion) {
        const version = await currentVersion()
        if (version !== null && clientVersion !== version) {
          const cacheControl = cacheControlValue(config)
          return c.body(null, 409, {
            // Relative path (not c.req.url): an absolute URL would send the client
            // to the internal origin behind a proxy. Matches page.url's format.
            'X-Inertia-Location': resolveUrl(c),
            'Vary': 'X-Inertia',
            ...(cacheControl !== undefined && { 'Cache-Control': cacheControl }),
          })
        }
      }
    }

    // Create response builder and attach to context
    const response = new InertiaResponse(c, config, currentVersion)
    c.set('inertia', response)

    // Apply global shared props
    if (config.share) {
      const shared = await config.share(c)
      response.share(shared)
    }

    // Apply global history encryption (per-request opt-out still possible)
    if (config.encryptHistory) {
      response.encryptHistory(true)
    }

    // Consume a flashed clearHistory cookie from a preceding redirect.
    // Prefetches are skipped: a prefetched page may be discarded client-side,
    // which would swallow the flag without ever clearing history.
    const hadClearHistoryCookie =
      !isPrefetch(c) && getCookie(c, CLEAR_HISTORY_COOKIE) !== undefined
    if (hadClearHistoryCookie) {
      response.clearHistory()
    }

    await next()

    // Post-handler: convert 302 → 303 for PUT/PATCH/DELETE on Inertia requests
    if (
      isInertiaRequest(c) &&
      c.res.status === 302 &&
      ['PUT', 'PATCH', 'DELETE'].includes(c.req.method)
    ) {
      const location = c.res.headers.get('Location') || '/'
      const headers = new Headers(c.res.headers)
      headers.set('Location', location)
      headers.set('Vary', 'X-Inertia')
      c.res = new Response(null, {
        status: 303,
        headers,
      })
    }

    // Flash clearHistory across redirects: set the cookie when the flag would
    // otherwise be lost, delete it once render() put it on the page (or the
    // handler cancelled it), and leave it untouched on unrelated responses —
    // a parallel non-page request must not eat the flag before the redirect
    // target renders. Max-Age bounds stray cookies.
    if (response.clearHistoryPending && isRedirectShaped(c.res)) {
      setCookie(c, CLEAR_HISTORY_COOKIE, '1', {
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
        maxAge: 60,
        secure: new URL(c.req.url).protocol === 'https:',
      })
    } else if (
      hadClearHistoryCookie &&
      (response.clearHistoryConsumed || !response.clearHistoryPending)
    ) {
      deleteCookie(c, CLEAR_HISTORY_COOKIE, { path: '/' })
    }

    // Ensure Vary: X-Inertia on all responses
    const vary = c.res.headers.get('Vary')
    if (!vary) {
      c.res.headers.set('Vary', 'X-Inertia')
    } else if (!vary.includes('X-Inertia')) {
      c.res.headers.set('Vary', `${vary}, X-Inertia`)
    }
  })
}
