import { createMiddleware } from 'hono/factory'
import type { MiddlewareHandler } from 'hono'
import type { InertiaConfig, InertiaEnv } from './types.js'
import { InertiaResponse } from './response.js'
import { cacheControlValue, getRequestVersion, isInertiaRequest, resolveUrl } from './utils.js'

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

    await next()

    // Post-handler: convert 302 → 303 for PUT/PATCH/DELETE on Inertia requests
    if (
      isInertiaRequest(c) &&
      c.res.status === 302 &&
      ['PUT', 'PATCH', 'DELETE'].includes(c.req.method)
    ) {
      const location = c.res.headers.get('Location') || '/'
      c.res = new Response(null, {
        status: 303,
        headers: {
          Location: location,
          'Vary': 'X-Inertia',
        },
      })
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
