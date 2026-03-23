import { createMiddleware } from 'hono/factory'
import type { MiddlewareHandler } from 'hono'
import type { InertiaConfig, InertiaEnv } from './types.js'
import { InertiaResponse } from './response.js'
import { getRequestVersion, isInertiaRequest } from './utils.js'

export function inertia(config: InertiaConfig): MiddlewareHandler<InertiaEnv> {
  return createMiddleware<InertiaEnv>(async (c, next) => {
    // Resolve current asset version
    const currentVersion =
      typeof config.version === 'function'
        ? await config.version()
        : config.version ?? ''

    // Version conflict check (before handler, GET only)
    if (
      isInertiaRequest(c) &&
      c.req.method === 'GET'
    ) {
      const clientVersion = getRequestVersion(c)
      if (clientVersion && clientVersion !== currentVersion) {
        return c.body(null, 409, {
          'X-Inertia-Location': c.req.url,
          'Vary': 'X-Inertia',
        })
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
