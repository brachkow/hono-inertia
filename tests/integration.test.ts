import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { inertia } from '../src/middleware.js'
import {
  always,
  deferred,
  deepMerge,
  merge,
  once,
  optional,
  prepend,
} from '../src/props.js'
import type { InertiaEnv, PageObject } from '../src/types.js'

function createApp(config?: Partial<Parameters<typeof inertia>[0]>) {
  const app = new Hono<InertiaEnv>()
  app.use(
    inertia({
      version: '1.0',
      render: (page) =>
        `<!DOCTYPE html><html><body><div id="app" data-page='${JSON.stringify(page)}'></div></body></html>`,
      ...config,
    }),
  )
  return app
}

function inertiaHeaders(extra: Record<string, string> = {}) {
  return {
    'X-Inertia': 'true',
    'X-Inertia-Version': '1.0',
    ...extra,
  }
}

async function getPage(res: Response): Promise<PageObject> {
  return res.json() as Promise<PageObject>
}

// =========================================================================
// 1. Detect Inertia requests via X-Inertia: true
// =========================================================================
describe('Inertia request detection', () => {
  it('returns HTML for non-Inertia requests', async () => {
    const app = createApp()
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/html')
    const body = await res.text()
    expect(body).toContain('data-page')
  })

  it('returns JSON for Inertia requests', async () => {
    const app = createApp()
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test', { headers: inertiaHeaders() })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect(res.headers.get('X-Inertia')).toBe('true')
  })
})

// =========================================================================
// 2. HTML with data-page attribute for initial visits
// =========================================================================
describe('Initial HTML visit', () => {
  it('includes data-page with serialized page object', async () => {
    const app = createApp()
    app.get('/users', (c) =>
      c.var.inertia.render('Users/Index', { users: [1, 2, 3] }),
    )

    const res = await app.request('/users')
    const body = await res.text()
    expect(body).toContain("data-page='")
    const match = body.match(/data-page='(.+?)'/)
    expect(match).not.toBeNull()
    const page = JSON.parse(match![1]) as PageObject
    expect(page.component).toBe('Users/Index')
    expect(page.props.users).toEqual([1, 2, 3])
  })
})

// =========================================================================
// 3. JSON with X-Inertia: true and Vary: X-Inertia headers
// =========================================================================
describe('Inertia JSON response headers', () => {
  it('sets X-Inertia and Vary headers on JSON responses', async () => {
    const app = createApp()
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test', { headers: inertiaHeaders() })
    expect(res.headers.get('X-Inertia')).toBe('true')
    expect(res.headers.get('Vary')).toContain('X-Inertia')
  })
})

// =========================================================================
// 4. Convert 302→303 redirects for PUT/PATCH/DELETE
// =========================================================================
describe('302→303 redirect conversion', () => {
  for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
    it(`converts 302 to 303 for ${method}`, async () => {
      const app = createApp()
      app.on(method, '/submit', (c) => c.redirect('/result', 302))

      const res = await app.request('/submit', {
        method,
        headers: inertiaHeaders(),
      })
      expect(res.status).toBe(303)
      expect(res.headers.get('Location')).toBe('/result')
    })
  }

  it('does not convert 302 for GET', async () => {
    const app = createApp()
    app.get('/old', (c) => c.redirect('/new', 302))

    const res = await app.request('/old', { headers: inertiaHeaders() })
    expect(res.status).toBe(302)
  })

  it('does not convert 302 for non-Inertia requests', async () => {
    const app = createApp()
    app.put('/submit', (c) => c.redirect('/result', 302))

    const res = await app.request('/submit', { method: 'PUT' })
    expect(res.status).toBe(302)
  })
})

// =========================================================================
// 5. Version mismatch → 409 (GET only)
// =========================================================================
describe('Asset versioning', () => {
  it('returns 409 on version mismatch for GET', async () => {
    const app = createApp({ version: '2.0' })
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test', {
      headers: { 'X-Inertia': 'true', 'X-Inertia-Version': '1.0' },
    })
    expect(res.status).toBe(409)
    expect(res.headers.get('X-Inertia-Location')).toContain('/test')
  })

  it('does not check version on POST', async () => {
    const app = createApp({ version: '2.0' })
    app.post('/submit', (c) => c.var.inertia.render('Result'))

    const res = await app.request('/submit', {
      method: 'POST',
      headers: { 'X-Inertia': 'true', 'X-Inertia-Version': '1.0' },
    })
    expect(res.status).toBe(200)
  })

  it('passes when versions match', async () => {
    const app = createApp({ version: '1.0' })
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test', { headers: inertiaHeaders() })
    expect(res.status).toBe(200)
  })

  it('supports version as a function', async () => {
    const app = createApp({ version: () => '3.0' })
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test', {
      headers: { 'X-Inertia': 'true', 'X-Inertia-Version': '3.0' },
    })
    expect(res.status).toBe(200)
  })
})

// =========================================================================
// 6. Always include errors prop
// =========================================================================
describe('Errors prop', () => {
  it('defaults errors to empty object', async () => {
    const app = createApp()
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.props.errors).toEqual({})
  })

  it('preserves provided errors', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', { errors: { name: 'Required' } }),
    )

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.props.errors).toEqual({ name: 'Required' })
  })
})

// =========================================================================
// 7. Relative URL in page object
// =========================================================================
describe('URL resolution', () => {
  it('includes relative URL with path', async () => {
    const app = createApp()
    app.get('/users/:id', (c) => c.var.inertia.render('Users/Show'))

    const res = await app.request('/users/42', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.url).toBe('/users/42')
  })

  it('preserves query string', async () => {
    const app = createApp()
    app.get('/search', (c) => c.var.inertia.render('Search'))

    const res = await app.request('/search?q=hello&page=2', {
      headers: inertiaHeaders(),
    })
    const page = await getPage(res)
    expect(page.url).toBe('/search?q=hello&page=2')
  })
})

// =========================================================================
// 8. External redirect via 409 + X-Inertia-Location
// =========================================================================
describe('External redirects', () => {
  it('returns 409 for Inertia requests', async () => {
    const app = createApp()
    app.get('/go', (c) => c.var.inertia.location('https://example.com'))

    const res = await app.request('/go', { headers: inertiaHeaders() })
    expect(res.status).toBe(409)
    expect(res.headers.get('X-Inertia-Location')).toBe('https://example.com')
  })

  it('returns 302 for non-Inertia requests', async () => {
    const app = createApp()
    app.get('/go', (c) => c.var.inertia.location('https://example.com'))

    const res = await app.request('/go')
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('https://example.com')
  })
})

// =========================================================================
// 9. Shared data merging
// =========================================================================
describe('Shared props', () => {
  it('merges shared props from middleware', async () => {
    const app = createApp()
    app.use(async (c, next) => {
      c.var.inertia.share({ auth: { user: 'Alice' } })
      await next()
    })
    app.get('/test', (c) => c.var.inertia.render('Test', { title: 'Home' }))

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.props.auth).toEqual({ user: 'Alice' })
    expect(page.props.title).toBe('Home')
  })

  it('render props override shared props', async () => {
    const app = createApp()
    app.use(async (c, next) => {
      c.var.inertia.share({ title: 'Default' })
      await next()
    })
    app.get('/test', (c) =>
      c.var.inertia.render('Test', { title: 'Override' }),
    )

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.props.title).toBe('Override')
  })

  it('supports global share via config', async () => {
    const app = createApp({
      share: () => ({ app: 'MyApp' }),
    })
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.props.app).toBe('MyApp')
  })
})

// =========================================================================
// 10. Partial reloads with include/exclude
// =========================================================================
describe('Partial reloads', () => {
  it('filters props with X-Inertia-Partial-Data', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        users: [1, 2],
        roles: ['admin'],
        settings: { dark: true },
      }),
    )

    const res = await app.request('/test', {
      headers: inertiaHeaders({
        'X-Inertia-Partial-Component': 'Test',
        'X-Inertia-Partial-Data': 'users,roles',
      }),
    })
    const page = await getPage(res)
    expect(page.props.users).toEqual([1, 2])
    expect(page.props.roles).toEqual(['admin'])
    expect(page.props.settings).toBeUndefined()
    // errors always included
    expect(page.props.errors).toEqual({})
  })

  it('filters props with X-Inertia-Partial-Except', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        users: [1],
        roles: ['admin'],
        settings: { dark: true },
      }),
    )

    const res = await app.request('/test', {
      headers: inertiaHeaders({
        'X-Inertia-Partial-Component': 'Test',
        'X-Inertia-Partial-Except': 'settings',
      }),
    })
    const page = await getPage(res)
    expect(page.props.users).toEqual([1])
    expect(page.props.roles).toEqual(['admin'])
    expect(page.props.settings).toBeUndefined()
  })
})

// =========================================================================
// 11. Partial component name verification
// =========================================================================
describe('Partial component verification', () => {
  it('ignores filters when component does not match', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        users: [1],
        roles: ['admin'],
      }),
    )

    const res = await app.request('/test', {
      headers: inertiaHeaders({
        'X-Inertia-Partial-Component': 'OtherComponent',
        'X-Inertia-Partial-Data': 'users',
      }),
    })
    const page = await getPage(res)
    // All props included because component doesn't match
    expect(page.props.users).toEqual([1])
    expect(page.props.roles).toEqual(['admin'])
  })
})

// =========================================================================
// 12. Lazy prop evaluation
// =========================================================================
describe('Lazy prop evaluation', () => {
  it('only calls functions when prop is needed', async () => {
    const usersFn = vi.fn(() => [1, 2, 3])
    const rolesFn = vi.fn(() => ['admin'])

    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', { users: usersFn, roles: rolesFn }),
    )

    const res = await app.request('/test', {
      headers: inertiaHeaders({
        'X-Inertia-Partial-Component': 'Test',
        'X-Inertia-Partial-Data': 'users',
      }),
    })
    const page = await getPage(res)
    expect(page.props.users).toEqual([1, 2, 3])
    expect(usersFn).toHaveBeenCalledOnce()
    expect(rolesFn).not.toHaveBeenCalled()
  })

  it('resolves async functions', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        users: async () => [1, 2, 3],
      }),
    )

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.props.users).toEqual([1, 2, 3])
  })
})

// =========================================================================
// 13. Optional props
// =========================================================================
describe('Optional props', () => {
  it('excludes optional props from full visits', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        users: [1],
        permissions: optional(() => ['read', 'write']),
      }),
    )

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.props.users).toEqual([1])
    expect(page.props.permissions).toBeUndefined()
  })

  it('includes optional props when requested in partial reload', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        users: [1],
        permissions: optional(() => ['read', 'write']),
      }),
    )

    const res = await app.request('/test', {
      headers: inertiaHeaders({
        'X-Inertia-Partial-Component': 'Test',
        'X-Inertia-Partial-Data': 'permissions',
      }),
    })
    const page = await getPage(res)
    expect(page.props.permissions).toEqual(['read', 'write'])
  })
})

// =========================================================================
// 14. Always props
// =========================================================================
describe('Always props', () => {
  it('includes always props in partial reloads regardless of filter', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        users: [1],
        auth: always({ user: 'Alice' }),
        roles: ['admin'],
      }),
    )

    const res = await app.request('/test', {
      headers: inertiaHeaders({
        'X-Inertia-Partial-Component': 'Test',
        'X-Inertia-Partial-Data': 'users',
      }),
    })
    const page = await getPage(res)
    expect(page.props.users).toEqual([1])
    expect(page.props.auth).toEqual({ user: 'Alice' })
    expect(page.props.roles).toBeUndefined()
  })

  it('includes always props on full visits', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        auth: always({ user: 'Alice' }),
      }),
    )

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.props.auth).toEqual({ user: 'Alice' })
  })
})

// =========================================================================
// 15. Deferred props
// =========================================================================
describe('Deferred props', () => {
  it('excludes deferred props from initial response', async () => {
    const fn = vi.fn(() => ['comment1'])
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        users: [1],
        comments: deferred(fn, 'sidebar'),
      }),
    )

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.props.comments).toBeUndefined()
    expect(page.deferredProps).toEqual({ sidebar: ['comments'] })
    expect(fn).not.toHaveBeenCalled()
  })

  it('includes deferred props when fetched via partial reload', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        users: [1],
        comments: deferred(() => ['comment1'], 'sidebar'),
      }),
    )

    const res = await app.request('/test', {
      headers: inertiaHeaders({
        'X-Inertia-Partial-Component': 'Test',
        'X-Inertia-Partial-Data': 'comments',
      }),
    })
    const page = await getPage(res)
    expect(page.props.comments).toEqual(['comment1'])
    expect(page.deferredProps).toBeUndefined()
  })
})

// =========================================================================
// 16. Merge/prepend/deepMerge metadata
// =========================================================================
describe('Merge props', () => {
  it('sets mergeProps in page object', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', { posts: merge(() => [1, 2]) }),
    )

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.props.posts).toEqual([1, 2])
    expect(page.mergeProps).toEqual(['posts'])
  })

  it('sets prependProps in page object', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', { posts: prepend(() => [1]) }),
    )

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.prependProps).toEqual(['posts'])
  })

  it('sets deepMergeProps in page object', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', { config: deepMerge(() => ({ a: 1 })) }),
    )

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.deepMergeProps).toEqual(['config'])
  })

  it('sets matchPropsOn for merge with matchOn', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        items: merge(() => []).setMatchOn('id'),
      }),
    )

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.mergeProps).toEqual(['items'])
    expect(page.matchPropsOn).toEqual(['items.id'])
  })

  it('strips merge metadata for reset props', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', { posts: merge(() => [1]) }),
    )

    const res = await app.request('/test', {
      headers: inertiaHeaders({
        'X-Inertia-Partial-Component': 'Test',
        'X-Inertia-Partial-Data': 'posts',
        'X-Inertia-Reset': 'posts',
      }),
    })
    const page = await getPage(res)
    expect(page.props.posts).toEqual([1])
    expect(page.mergeProps).toBeUndefined()
  })
})

// =========================================================================
// 17. Once props
// =========================================================================
describe('Once props', () => {
  it('includes once props with metadata', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        plans: once(() => ['free', 'pro']),
      }),
    )

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.props.plans).toEqual(['free', 'pro'])
    expect(page.onceProps).toEqual({
      plans: { prop: 'plans', expiresAt: null },
    })
  })

  it('skips once props listed in X-Inertia-Except-Once-Props', async () => {
    const fn = vi.fn(() => ['free', 'pro'])
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', { plans: once(fn) }),
    )

    const res = await app.request('/test', {
      headers: inertiaHeaders({
        'X-Inertia-Except-Once-Props': 'plans',
      }),
    })
    const page = await getPage(res)
    expect(page.props.plans).toBeUndefined()
    expect(fn).not.toHaveBeenCalled()
  })
})

// =========================================================================
// 18. History encryption
// =========================================================================
describe('History encryption', () => {
  it('defaults to encryptHistory: false, clearHistory: false', async () => {
    const app = createApp()
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.encryptHistory).toBe(false)
    expect(page.clearHistory).toBe(false)
  })

  it('sets encryptHistory when enabled', async () => {
    const app = createApp()
    app.get('/test', (c) => {
      c.var.inertia.encryptHistory()
      return c.var.inertia.render('Test')
    })

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.encryptHistory).toBe(true)
  })

  it('sets clearHistory when enabled', async () => {
    const app = createApp()
    app.get('/test', (c) => {
      c.var.inertia.clearHistory()
      return c.var.inertia.render('Test')
    })

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.clearHistory).toBe(true)
  })
})

// =========================================================================
// 19. Error bag support
// =========================================================================
describe('Error bag', () => {
  it('scopes errors to bag name', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        errors: {
          createUser: { name: 'Required' },
          updateUser: { email: 'Invalid' },
        },
      }),
    )

    const res = await app.request('/test', {
      headers: inertiaHeaders({ 'X-Inertia-Error-Bag': 'createUser' }),
    })
    const page = await getPage(res)
    expect(page.props.errors).toEqual({ name: 'Required' })
  })

  it('returns empty errors when bag is not found', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        errors: { createUser: { name: 'Required' } },
      }),
    )

    const res = await app.request('/test', {
      headers: inertiaHeaders({ 'X-Inertia-Error-Bag': 'nonexistent' }),
    })
    const page = await getPage(res)
    expect(page.props.errors).toEqual({})
  })
})

// =========================================================================
// 20. Vary: X-Inertia on ALL responses
// =========================================================================
describe('Vary header', () => {
  it('sets Vary on HTML responses', async () => {
    const app = createApp()
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test')
    expect(res.headers.get('Vary')).toContain('X-Inertia')
  })

  it('sets Vary on JSON responses', async () => {
    const app = createApp()
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test', { headers: inertiaHeaders() })
    expect(res.headers.get('Vary')).toContain('X-Inertia')
  })

  it('sets Vary on redirect responses', async () => {
    const app = createApp()
    app.get('/old', (c) => c.redirect('/new'))

    const res = await app.request('/old')
    expect(res.headers.get('Vary')).toContain('X-Inertia')
  })

  it('appends to existing Vary header', async () => {
    const app = createApp()
    app.get('/test', (c) => {
      c.header('Vary', 'Accept')
      return c.var.inertia.render('Test')
    })

    const res = await app.request('/test')
    const vary = res.headers.get('Vary')
    expect(vary).toContain('Accept')
    expect(vary).toContain('X-Inertia')
  })
})

// =========================================================================
// View data
// =========================================================================
describe('View data', () => {
  it('passes view data to render function but not to page props', async () => {
    let receivedViewData: Record<string, unknown> | undefined

    const app = new Hono<InertiaEnv>()
    app.use(
      inertia({
        version: '1.0',
        render: (page, viewData) => {
          receivedViewData = viewData
          return `<div data-page='${JSON.stringify(page)}'></div>`
        },
      }),
    )
    app.get('/test', (c) => {
      c.var.inertia.viewData({ metaTitle: 'My Page' })
      return c.var.inertia.render('Test', { title: 'Hello' })
    })

    const res = await app.request('/test')
    expect(receivedViewData).toEqual({ metaTitle: 'My Page' })
    const body = await res.text()
    const page = JSON.parse(body.match(/data-page='(.+?)'/)?.[1] ?? '{}')
    expect(page.props.metaTitle).toBeUndefined()
    expect(page.props.title).toBe('Hello')
  })
})

// =========================================================================
// Page object structure
// =========================================================================
describe('Page object structure', () => {
  it('includes all required fields', async () => {
    const app = createApp()
    app.get('/test', (c) => c.var.inertia.render('Test', { data: 'value' }))

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page).toEqual({
      component: 'Test',
      props: { errors: {}, data: 'value' },
      url: '/test',
      version: '1.0',
      encryptHistory: false,
      clearHistory: false,
    })
  })

  it('omits optional fields when not needed', async () => {
    const app = createApp()
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.deferredProps).toBeUndefined()
    expect(page.mergeProps).toBeUndefined()
    expect(page.prependProps).toBeUndefined()
    expect(page.deepMergeProps).toBeUndefined()
    expect(page.onceProps).toBeUndefined()
    expect(page.matchPropsOn).toBeUndefined()
  })
})
