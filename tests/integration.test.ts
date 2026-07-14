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
  scroll,
} from '../src/props.js'
import { serializePage } from '../src/serialize.js'
import type { InertiaEnv, PageObject, ScrollMetadata } from '../src/types.js'

function createApp(config?: Partial<Parameters<typeof inertia>[0]>) {
  const app = new Hono<InertiaEnv>()
  app.use(
    inertia({
      version: '1.0',
      render: (page) =>
        `<!DOCTYPE html><html><body><div id="app" data-page="${serializePage(page)}"></div></body></html>`,
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

function htmlDecode(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

function parsePageFromHtml(html: string): PageObject {
  const match = html.match(/data-page="([^"]*)"/)
  if (!match) throw new Error('no data-page attribute in HTML')
  return JSON.parse(htmlDecode(match[1])) as PageObject
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
    expect(body).toContain('data-page=')
    expect(body).toContain('<div id="app"')
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
// 2. HTML with page data script tag for initial visits
// =========================================================================
describe('Initial HTML visit', () => {
  it('embeds page data in the data-page attribute', async () => {
    const app = createApp()
    app.get('/users', (c) =>
      c.var.inertia.render('Users/Index', { users: [1, 2, 3] }),
    )

    const res = await app.request('/users')
    const body = await res.text()
    expect(body).toContain('<div id="app" data-page="')
    const page = parsePageFromHtml(body)
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

  it('skips a once prop when the client echoes its custom key', async () => {
    const fn = vi.fn(() => ['free', 'pro'])
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', { plans: once(fn, 'plans-cache') }),
    )

    const res = await app.request('/test', {
      headers: inertiaHeaders({ 'X-Inertia-Except-Once-Props': 'plans-cache' }),
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
  it('omits encryptHistory and clearHistory when not enabled', async () => {
    const app = createApp()
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.encryptHistory).toBeUndefined()
    expect(page.clearHistory).toBeUndefined()
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
          return `<div id="app" data-page="${serializePage(page)}"></div>`
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
    const page = parsePageFromHtml(body)
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

// =========================================================================
// Combinatorial prop types
// =========================================================================
describe('Combinatorial prop types', () => {
  it('handles all prop types in a single render call', async () => {
    const deferredFn = vi.fn(() => 'deferred-value')
    const optionalFn = vi.fn(() => 'optional-value')

    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        plain: 'hello',
        lazy: () => 'lazy-value',
        alwaysProp: always('always-value'),
        optProp: optional(optionalFn),
        deferProp: deferred(deferredFn, 'sidebar'),
        mergeProp: merge(() => [1, 2]),
        onceProp: once(() => 'once-value'),
      }),
    )

    // Full visit
    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)

    expect(page.props.plain).toBe('hello')
    expect(page.props.lazy).toBe('lazy-value')
    expect(page.props.alwaysProp).toBe('always-value')
    expect(page.props.optProp).toBeUndefined()
    expect(page.props.deferProp).toBeUndefined()
    expect(page.props.mergeProp).toEqual([1, 2])
    expect(page.props.onceProp).toBe('once-value')

    expect(page.deferredProps).toEqual({ sidebar: ['deferProp'] })
    expect(page.mergeProps).toEqual(['mergeProp'])
    expect(page.onceProps).toEqual({
      onceProp: { prop: 'onceProp', expiresAt: null },
    })

    expect(deferredFn).not.toHaveBeenCalled()
    expect(optionalFn).not.toHaveBeenCalled()
  })

  it('handles all prop types in a partial reload requesting specific keys', async () => {
    const deferredFn = vi.fn(() => 'deferred-value')
    const optionalFn = vi.fn(() => 'optional-value')
    const lazyFn = vi.fn(() => 'lazy-value')
    const mergeFn = vi.fn(() => [1, 2])

    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        plain: 'hello',
        lazy: lazyFn,
        alwaysProp: always('always-value'),
        optProp: optional(optionalFn),
        deferProp: deferred(deferredFn, 'sidebar'),
        mergeProp: merge(mergeFn),
        onceProp: once(() => 'once-value'),
      }),
    )

    const res = await app.request('/test', {
      headers: inertiaHeaders({
        'X-Inertia-Partial-Component': 'Test',
        'X-Inertia-Partial-Data': 'optProp,deferProp',
      }),
    })
    const page = await getPage(res)

    // Only requested + always + errors
    expect(page.props.optProp).toBe('optional-value')
    expect(page.props.deferProp).toBe('deferred-value')
    expect(page.props.alwaysProp).toBe('always-value')
    expect(page.props.errors).toEqual({})

    // Not requested — not included
    expect(page.props.plain).toBeUndefined()
    expect(page.props.lazy).toBeUndefined()
    expect(page.props.mergeProp).toBeUndefined()
    expect(page.props.onceProp).toBeUndefined()

    // Only requested fns called
    expect(optionalFn).toHaveBeenCalledOnce()
    expect(deferredFn).toHaveBeenCalledOnce()
    expect(lazyFn).not.toHaveBeenCalled()
    expect(mergeFn).not.toHaveBeenCalled()
  })
})

// =========================================================================
// Multiple deferred groups
// =========================================================================
describe('Multiple deferred groups', () => {
  it('registers multiple groups in deferredProps', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        title: 'Page',
        comments: deferred(() => ['c1'], 'sidebar'),
        likes: deferred(() => 42, 'sidebar'),
        analytics: deferred(() => ({ views: 100 }), 'footer'),
        related: deferred(() => ['r1'], 'aside'),
      }),
    )

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)

    expect(page.deferredProps).toEqual({
      sidebar: ['comments', 'likes'],
      footer: ['analytics'],
      aside: ['related'],
    })
    expect(page.props.comments).toBeUndefined()
    expect(page.props.likes).toBeUndefined()
    expect(page.props.analytics).toBeUndefined()
    expect(page.props.related).toBeUndefined()
    expect(page.props.title).toBe('Page')
  })

  it('fetches only requested deferred props from one group', async () => {
    const sidebarFn = vi.fn(() => ['c1'])
    const footerFn = vi.fn(() => ({ views: 100 }))

    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        comments: deferred(sidebarFn, 'sidebar'),
        analytics: deferred(footerFn, 'footer'),
      }),
    )

    const res = await app.request('/test', {
      headers: inertiaHeaders({
        'X-Inertia-Partial-Component': 'Test',
        'X-Inertia-Partial-Data': 'comments',
      }),
    })
    const page = await getPage(res)

    expect(page.props.comments).toEqual(['c1'])
    expect(page.props.analytics).toBeUndefined()
    expect(sidebarFn).toHaveBeenCalledOnce()
    expect(footerFn).not.toHaveBeenCalled()
  })

  it('handles deferred with merge+once chaining', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        feed: deferred(() => [1, 2], 'main').merge().once('feed-key', 3600),
      }),
    )

    // Full visit: listed in deferredProps with merge metadata
    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)

    expect(page.props.feed).toBeUndefined()
    expect(page.deferredProps).toEqual({ main: ['feed'] })
    expect(page.mergeProps).toEqual(['feed'])

    // Partial fetch: includes value with merge+once metadata
    const res2 = await app.request('/test', {
      headers: inertiaHeaders({
        'X-Inertia-Partial-Component': 'Test',
        'X-Inertia-Partial-Data': 'feed',
      }),
    })
    const page2 = await getPage(res2)

    expect(page2.props.feed).toEqual([1, 2])
    expect(page2.mergeProps).toEqual(['feed'])
    expect(page2.onceProps).toEqual({
      'feed-key': { prop: 'feed', expiresAt: 3600 },
    })
  })

  it('skips deferred+once prop when client already has it', async () => {
    const fn = vi.fn(() => [1, 2])

    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        feed: deferred(fn, 'main').once(),
      }),
    )

    const res = await app.request('/test', {
      headers: inertiaHeaders({
        'X-Inertia-Partial-Component': 'Test',
        'X-Inertia-Partial-Data': 'feed',
        'X-Inertia-Except-Once-Props': 'feed',
      }),
    })
    const page = await getPage(res)

    expect(page.props.feed).toBeUndefined()
    expect(fn).not.toHaveBeenCalled()
  })
})

// =========================================================================
// Optional + once chaining
// =========================================================================
describe('Optional + once chaining', () => {
  it('excludes optional+once from full visits', async () => {
    const fn = vi.fn(() => 'data')
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        expensive: optional(fn).once('exp-key', 7200),
      }),
    )

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)

    expect(page.props.expensive).toBeUndefined()
    expect(fn).not.toHaveBeenCalled()
  })

  it('includes optional+once on partial reload with once metadata', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        expensive: optional(() => 'data').once('exp-key', 7200),
      }),
    )

    const res = await app.request('/test', {
      headers: inertiaHeaders({
        'X-Inertia-Partial-Component': 'Test',
        'X-Inertia-Partial-Data': 'expensive',
      }),
    })
    const page = await getPage(res)

    expect(page.props.expensive).toBe('data')
    expect(page.onceProps).toEqual({
      'exp-key': { prop: 'expensive', expiresAt: 7200 },
    })
  })

  it('skips optional+once when client already has it', async () => {
    const fn = vi.fn(() => 'data')
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        expensive: optional(fn).once(),
      }),
    )

    const res = await app.request('/test', {
      headers: inertiaHeaders({
        'X-Inertia-Partial-Component': 'Test',
        'X-Inertia-Partial-Data': 'expensive',
        'X-Inertia-Except-Once-Props': 'expensive',
      }),
    })
    const page = await getPage(res)

    expect(page.props.expensive).toBeUndefined()
    expect(fn).not.toHaveBeenCalled()
  })
})

// =========================================================================
// Partial reload edge cases
// =========================================================================
describe('Partial reload edge cases', () => {
  it('handles both Partial-Data and Partial-Except simultaneously', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        a: 'A',
        b: 'B',
        c: 'C',
        d: 'D',
      }),
    )

    const res = await app.request('/test', {
      headers: inertiaHeaders({
        'X-Inertia-Partial-Component': 'Test',
        'X-Inertia-Partial-Data': 'a,b,c',
        'X-Inertia-Partial-Except': 'b',
      }),
    })
    const page = await getPage(res)

    // Partial-Data includes a,b,c; Partial-Except removes b
    expect(page.props.a).toBe('A')
    expect(page.props.b).toBeUndefined()
    expect(page.props.c).toBe('C')
    expect(page.props.d).toBeUndefined()
  })

  it('always preserves errors even when not in Partial-Data', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        users: [1],
        errors: { name: 'Required' },
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
    expect(page.props.errors).toEqual({ name: 'Required' })
  })

  it('cannot exclude errors via Partial-Except', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        users: [1],
        errors: { name: 'Required' },
      }),
    )

    const res = await app.request('/test', {
      headers: inertiaHeaders({
        'X-Inertia-Partial-Component': 'Test',
        'X-Inertia-Partial-Except': 'errors',
      }),
    })
    const page = await getPage(res)

    expect(page.props.errors).toEqual({ name: 'Required' })
    expect(page.props.users).toEqual([1])
  })

  it('excludes optional props when component does not match', async () => {
    const fn = vi.fn(() => 'opt')
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        plain: 'hello',
        opt: optional(fn),
      }),
    )

    const res = await app.request('/test', {
      headers: inertiaHeaders({
        'X-Inertia-Partial-Component': 'Other',
        'X-Inertia-Partial-Data': 'opt',
      }),
    })
    const page = await getPage(res)

    // Component mismatch → treated as full visit → optional excluded
    expect(page.props.plain).toBe('hello')
    expect(page.props.opt).toBeUndefined()
    expect(fn).not.toHaveBeenCalled()
  })

  it('does not show deferredProps in partial reload response', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        users: [1],
        comments: deferred(() => ['c1'], 'sidebar'),
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
    expect(page.deferredProps).toBeUndefined()
  })
})

// =========================================================================
// Shared props accumulation
// =========================================================================
describe('Shared props accumulation', () => {
  it('accumulates from multiple share() calls', async () => {
    const app = createApp()
    app.use(async (c, next) => {
      c.var.inertia.share({ a: 1 })
      c.var.inertia.share({ b: 2 })
      await next()
    })
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.props.a).toBe(1)
    expect(page.props.b).toBe(2)
  })

  it('later share() calls override earlier keys', async () => {
    const app = createApp()
    app.use(async (c, next) => {
      c.var.inertia.share({ x: 'first' })
      c.var.inertia.share({ x: 'second' })
      await next()
    })
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.props.x).toBe('second')
  })

  it('merges config share + middleware share + render props', async () => {
    const app = createApp({
      share: () => ({ fromConfig: 'config', shared: 'config' }),
    })
    app.use(async (c, next) => {
      c.var.inertia.share({ fromMiddleware: 'middleware', shared: 'middleware' })
      await next()
    })
    app.get('/test', (c) =>
      c.var.inertia.render('Test', { fromRender: 'render', shared: 'render' }),
    )

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)

    expect(page.props.fromConfig).toBe('config')
    expect(page.props.fromMiddleware).toBe('middleware')
    expect(page.props.fromRender).toBe('render')
    // Render props win over middleware, middleware wins over config
    expect(page.props.shared).toBe('render')
  })

  it('accumulates share() across chained middleware', async () => {
    const app = createApp()
    app.use(async (c, next) => {
      c.var.inertia.share({ from1: 'mw1' })
      await next()
    })
    app.use(async (c, next) => {
      c.var.inertia.share({ from2: 'mw2' })
      await next()
    })
    app.use(async (c, next) => {
      c.var.inertia.share({ from3: 'mw3' })
      await next()
    })
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.props.from1).toBe('mw1')
    expect(page.props.from2).toBe('mw2')
    expect(page.props.from3).toBe('mw3')
  })
})

// =========================================================================
// Reset props edge cases
// =========================================================================
describe('Reset props edge cases', () => {
  it('strips merge metadata but preserves value on reset', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        posts: merge(() => [1, 2, 3]).setMatchOn('id'),
      }),
    )

    const res = await app.request('/test', {
      headers: inertiaHeaders({
        'X-Inertia-Partial-Component': 'Test',
        'X-Inertia-Partial-Data': 'posts',
        'X-Inertia-Reset': 'posts',
      }),
    })
    const page = await getPage(res)

    expect(page.props.posts).toEqual([1, 2, 3])
    expect(page.mergeProps).toBeUndefined()
    expect(page.matchPropsOn).toBeUndefined()
  })

  it('strips merge metadata on deferred+merge reset', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        feed: deferred(() => [1, 2], 'main').merge(),
      }),
    )

    const res = await app.request('/test', {
      headers: inertiaHeaders({
        'X-Inertia-Partial-Component': 'Test',
        'X-Inertia-Partial-Data': 'feed',
        'X-Inertia-Reset': 'feed',
      }),
    })
    const page = await getPage(res)

    expect(page.props.feed).toEqual([1, 2])
    expect(page.mergeProps).toBeUndefined()
  })
})

// =========================================================================
// Once props edge cases
// =========================================================================
describe('Once props edge cases', () => {
  it('uses custom key in onceProps metadata', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        plans: once(() => ['free'], 'custom-plans-key', 3600),
      }),
    )

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)

    expect(page.onceProps).toEqual({
      'custom-plans-key': { prop: 'plans', expiresAt: 3600 },
    })
  })

  it('passes through expiresAt value', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        config: once(() => ({}), undefined, 86400),
      }),
    )

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)

    expect(page.onceProps?.config?.expiresAt).toBe(86400)
  })
})

// =========================================================================
// URL edge cases
// =========================================================================
describe('URL edge cases', () => {
  it('preserves trailing slash', async () => {
    const app = createApp()
    app.get('/users/', (c) => c.var.inertia.render('Users'))

    const res = await app.request('/users/', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.url).toBe('/users/')
  })

  it('handles query with special characters', async () => {
    const app = createApp()
    app.get('/search', (c) => c.var.inertia.render('Search'))

    const res = await app.request('/search?q=hello%20world&tag=c%2B%2B', {
      headers: inertiaHeaders(),
    })
    const page = await getPage(res)
    expect(page.url).toBe('/search?q=hello%20world&tag=c%2B%2B')
  })

  it('handles path without query string', async () => {
    const app = createApp()
    app.get('/users', (c) => c.var.inertia.render('Users'))

    const res = await app.request('/users', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.url).toBe('/users')
  })
})

// =========================================================================
// History encryption edge cases
// =========================================================================
describe('History encryption edge cases', () => {
  it('can explicitly disable encryptHistory with false', async () => {
    const app = createApp()
    app.get('/test', (c) => {
      c.var.inertia.encryptHistory(true)
      c.var.inertia.encryptHistory(false)
      return c.var.inertia.render('Test')
    })

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.encryptHistory).toBeUndefined()
  })

  it('can explicitly disable clearHistory with false', async () => {
    const app = createApp()
    app.get('/test', (c) => {
      c.var.inertia.clearHistory(true)
      c.var.inertia.clearHistory(false)
      return c.var.inertia.render('Test')
    })

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.clearHistory).toBeUndefined()
  })

  it('supports both encryptHistory and clearHistory together', async () => {
    const app = createApp()
    app.get('/test', (c) => {
      c.var.inertia.encryptHistory()
      c.var.inertia.clearHistory()
      return c.var.inertia.render('Test')
    })

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.encryptHistory).toBe(true)
    expect(page.clearHistory).toBe(true)
  })
})

// =========================================================================
// View data edge cases
// =========================================================================
describe('View data edge cases', () => {
  it('accumulates from multiple viewData() calls', async () => {
    let receivedViewData: Record<string, unknown> | undefined

    const app = new Hono<InertiaEnv>()
    app.use(
      inertia({
        version: '1.0',
        render: (page, viewData) => {
          receivedViewData = viewData
          return `<div id="app" data-page="${serializePage(page)}"></div>`
        },
      }),
    )
    app.get('/test', (c) => {
      c.var.inertia.viewData({ a: 1 })
      c.var.inertia.viewData({ b: 2 })
      return c.var.inertia.render('Test')
    })

    await app.request('/test')
    expect(receivedViewData).toEqual({ a: 1, b: 2 })
  })

  it('merges render viewData arg with accumulated viewData', async () => {
    let receivedViewData: Record<string, unknown> | undefined

    const app = new Hono<InertiaEnv>()
    app.use(
      inertia({
        version: '1.0',
        render: (page, viewData) => {
          receivedViewData = viewData
          return `<div id="app" data-page="${serializePage(page)}"></div>`
        },
      }),
    )
    app.get('/test', (c) => {
      c.var.inertia.viewData({ fromMethod: 'method', shared: 'method' })
      return c.var.inertia.render('Test', {}, { fromRender: 'render', shared: 'render' })
    })

    await app.request('/test')
    expect(receivedViewData).toEqual({
      fromMethod: 'method',
      fromRender: 'render',
      shared: 'render',
    })
  })

  it('does not send view data on Inertia JSON responses', async () => {
    let receivedViewData: Record<string, unknown> | undefined
    let renderCalled = false

    const app = new Hono<InertiaEnv>()
    app.use(
      inertia({
        version: '1.0',
        render: (_page, viewData) => {
          renderCalled = true
          receivedViewData = viewData
          return '<div></div>'
        },
      }),
    )
    app.get('/test', (c) => {
      c.var.inertia.viewData({ meta: 'value' })
      return c.var.inertia.render('Test')
    })

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)

    // Render function not called for JSON responses
    expect(renderCalled).toBe(false)
    expect(page.props.meta).toBeUndefined()
  })
})

// =========================================================================
// Error bag edge cases
// =========================================================================
describe('Error bag edge cases', () => {
  it('returns empty errors when errors is empty and bag is requested', async () => {
    const app = createApp()
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test', {
      headers: inertiaHeaders({ 'X-Inertia-Error-Bag': 'createUser' }),
    })
    const page = await getPage(res)
    expect(page.props.errors).toEqual({})
  })

  it('returns full errors when no error bag header is sent', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        errors: {
          createUser: { name: 'Required' },
          updateUser: { email: 'Invalid' },
        },
      }),
    )

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.props.errors).toEqual({
      createUser: { name: 'Required' },
      updateUser: { email: 'Invalid' },
    })
  })
})

// =========================================================================
// Async version function
// =========================================================================
describe('Async version function', () => {
  it('resolves async version and matches', async () => {
    const app = createApp({
      version: async () => 'async-v1',
    })
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test', {
      headers: {
        'X-Inertia': 'true',
        'X-Inertia-Version': 'async-v1',
      },
    })
    expect(res.status).toBe(200)
    const page = await getPage(res)
    expect(page.version).toBe('async-v1')
  })

  it('resolves async version and returns 409 on mismatch', async () => {
    const app = createApp({
      version: async () => 'async-v2',
    })
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test', {
      headers: {
        'X-Inertia': 'true',
        'X-Inertia-Version': 'old-version',
      },
    })
    expect(res.status).toBe(409)
    expect(res.headers.get('X-Inertia-Location')).toContain('/test')
  })
})

// =========================================================================
// SSR integration
// =========================================================================
describe('SSR integration', () => {
  it('passes SSR result to render function', async () => {
    let receivedSsr: { head: string; body: string } | undefined

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: () =>
        Promise.resolve({
          head: ['<title>SSR</title>'],
          body: '<div id="app">rendered</div>',
        }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const app = new Hono<InertiaEnv>()
    app.use(
      inertia({
        version: '1.0',
        ssr: { url: 'http://localhost:13714' },
        render: (page, _viewData, ssr) => {
          receivedSsr = ssr
          return `<html>${ssr?.head ?? ''}<body>${ssr?.body ?? serializePage(page)}</body></html>`
        },
      }),
    )
    app.get('/test', (c) => c.var.inertia.render('Test', { data: 1 }))

    const res = await app.request('/test')
    expect(res.status).toBe(200)
    expect(receivedSsr).toEqual({
      head: '<title>SSR</title>',
      body: '<div id="app">rendered</div>',
    })
    expect(mockFetch).toHaveBeenCalledOnce()

    vi.restoreAllMocks()
  })

  it('falls back gracefully when SSR fails', async () => {
    let receivedSsr: { head: string; body: string } | undefined

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    const app = new Hono<InertiaEnv>()
    app.use(
      inertia({
        version: '1.0',
        ssr: { url: 'http://localhost:13714' },
        render: (page, _viewData, ssr) => {
          receivedSsr = ssr
          return `<div id="app" data-page="${serializePage(page)}"></div>`
        },
      }),
    )
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test')
    expect(res.status).toBe(200)
    expect(receivedSsr).toBeUndefined()

    vi.restoreAllMocks()
  })

  it('skips SSR for Inertia JSON requests', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    const app = new Hono<InertiaEnv>()
    app.use(
      inertia({
        version: '1.0',
        ssr: { url: 'http://localhost:13714' },
        render: (page) => `<div id="app" data-page="${serializePage(page)}"></div>`,
      }),
    )
    app.get('/test', (c) => c.var.inertia.render('Test'))

    await app.request('/test', { headers: inertiaHeaders() })
    expect(mockFetch).not.toHaveBeenCalled()

    vi.restoreAllMocks()
  })

  it('skips SSR when ssr.enabled is false', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    const app = new Hono<InertiaEnv>()
    app.use(
      inertia({
        version: '1.0',
        ssr: { url: 'http://localhost:13714', enabled: false },
        render: (page) => `<div id="app" data-page="${serializePage(page)}"></div>`,
      }),
    )
    app.get('/test', (c) => c.var.inertia.render('Test'))

    await app.request('/test')
    expect(mockFetch).not.toHaveBeenCalled()

    vi.restoreAllMocks()
  })
})

// =========================================================================
// Lazy evaluation edge cases
// =========================================================================
describe('Lazy evaluation edge cases', () => {
  it('handles lazy function returning null', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', { data: () => null }),
    )

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.props.data).toBeNull()
  })

  it('handles lazy function returning undefined', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', { data: () => undefined }),
    )

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.props.data).toBeUndefined()
  })

  it('resolves multiple async lazy functions in parallel', async () => {
    const order: string[] = []

    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        a: async () => {
          order.push('a-start')
          await new Promise((r) => setTimeout(r, 50))
          order.push('a-end')
          return 'A'
        },
        b: async () => {
          order.push('b-start')
          await new Promise((r) => setTimeout(r, 10))
          order.push('b-end')
          return 'B'
        },
      }),
    )

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)

    expect(page.props.a).toBe('A')
    expect(page.props.b).toBe('B')
    // Both should start before either finishes (parallel)
    expect(order[0]).toBe('a-start')
    expect(order[1]).toBe('b-start')
  })

  it('handles merge prop with lazy function value', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        posts: merge(async () => [1, 2, 3]),
      }),
    )

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.props.posts).toEqual([1, 2, 3])
    expect(page.mergeProps).toEqual(['posts'])
  })
})

// =========================================================================
// Version defaults
// =========================================================================
describe('Version defaults', () => {
  const createUnversionedApp = () => {
    const app = new Hono<InertiaEnv>()
    app.use(
      inertia({
        render: (page) => `<div id="app" data-page="${serializePage(page)}"></div>`,
      }),
    )
    app.get('/test', (c) => c.var.inertia.render('Test'))
    return app
  }

  it('emits version null when no version is configured', async () => {
    const app = createUnversionedApp()

    const res = await app.request('/test', {
      headers: { 'X-Inertia': 'true' },
    })

    expect(res.status).toBe(200)
    const page = await getPage(res)
    expect(page.version).toBe(null)
  })

  it('never 409s when versioning is disabled, even if the client sends a version', async () => {
    const app = createUnversionedApp()

    const res = await app.request('/test', {
      headers: { 'X-Inertia': 'true', 'X-Inertia-Version': 'stale-version' },
    })

    expect(res.status).toBe(200)
  })

  it('never 409s on a missing X-Inertia-Version header', async () => {
    const app = createApp({ version: '2.0' })
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test', { headers: { 'X-Inertia': 'true' } })

    expect(res.status).toBe(200)
  })

  it('never 409s on an empty X-Inertia-Version header', async () => {
    const app = createApp({ version: '2.0' })
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test', {
      headers: { 'X-Inertia': 'true', 'X-Inertia-Version': '' },
    })

    expect(res.status).toBe(200)
  })
})

describe('Cache-Control', () => {
  const DEFAULT = 'private, no-cache, must-revalidate'

  it('sets the default header on Inertia JSON responses', async () => {
    const app = createApp()
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test', { headers: inertiaHeaders() })

    expect(res.headers.get('Cache-Control')).toBe(DEFAULT)
  })

  it('sets the default header on initial HTML responses', async () => {
    const app = createApp()
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test')

    expect(res.headers.get('Cache-Control')).toBe(DEFAULT)
  })

  it('sets the default header on 409 version mismatches', async () => {
    const app = createApp({ version: '2.0' })
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test', {
      headers: { 'X-Inertia': 'true', 'X-Inertia-Version': '1.0' },
    })

    expect(res.status).toBe(409)
    expect(res.headers.get('Cache-Control')).toBe(DEFAULT)
  })

  it('sets the default header on location() 409 responses', async () => {
    const app = createApp()
    app.get('/away', (c) => c.var.inertia.location('https://example.com'))

    const res = await app.request('/away', { headers: inertiaHeaders() })

    expect(res.status).toBe(409)
    expect(res.headers.get('Cache-Control')).toBe(DEFAULT)
  })

  it('sets the default header on redirect() 409 responses', async () => {
    const app = createApp()
    app.get('/away', (c) => c.var.inertia.redirect('/other#section'))

    const res = await app.request('/away', { headers: inertiaHeaders() })

    expect(res.status).toBe(409)
    expect(res.headers.get('Cache-Control')).toBe(DEFAULT)
  })

  it('uses a custom cacheControl value', async () => {
    const app = createApp({ cacheControl: 'no-store' })
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test', { headers: inertiaHeaders() })

    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('omits the header when cacheControl is false', async () => {
    const app = createApp({ cacheControl: false })
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test', { headers: inertiaHeaders() })

    expect(res.headers.get('Cache-Control')).toBe(null)
  })

  it('preserves a handler-set Cache-Control on HTML responses', async () => {
    const app = createApp()
    app.get('/test', (c) => {
      c.header('Cache-Control', 'public, max-age=60')
      return c.var.inertia.render('Test')
    })

    const res = await app.request('/test')

    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60')
  })

  it('does not stamp passthrough responses', async () => {
    const app = createApp()
    app.get('/api', (c) => c.json({ ok: true }))

    const res = await app.request('/api')

    expect(res.headers.get('Cache-Control')).toBe(null)
  })
})

describe('Lazy version resolution', () => {
  const createCountingApp = () => {
    let calls = 0
    const app = new Hono<InertiaEnv>()
    app.use(
      inertia({
        version: () => {
          calls++
          return '1.0'
        },
        render: (page) => `<div id="app" data-page="${serializePage(page)}"></div>`,
      }),
    )
    app.get('/page', (c) => c.var.inertia.render('Test'))
    app.get('/passthrough', (c) => c.json({ ok: true }))
    app.post('/action', (c) => c.redirect('/page'))
    return { app, calls: () => calls }
  }

  it('does not resolve the version on passthrough routes', async () => {
    const { app, calls } = createCountingApp()

    await app.request('/passthrough')

    expect(calls()).toBe(0)
  })

  it('does not resolve the version on POST requests that never render', async () => {
    const { app, calls } = createCountingApp()

    await app.request('/action', {
      method: 'POST',
      headers: { 'X-Inertia': 'true', 'X-Inertia-Version': '0.9' },
    })

    expect(calls()).toBe(0)
  })

  it('resolves the version at most once per rendering request', async () => {
    const { app, calls } = createCountingApp()

    await app.request('/page', {
      headers: { 'X-Inertia': 'true', 'X-Inertia-Version': '1.0' },
    })

    expect(calls()).toBe(1)
  })
})

// =========================================================================
// 302→303 redirect edge cases
// =========================================================================
describe('302→303 redirect edge cases', () => {
  it('preserves 301 redirects unchanged', async () => {
    const app = createApp()
    app.put('/submit', (c) => c.redirect('/result', 301))

    const res = await app.request('/submit', {
      method: 'PUT',
      headers: inertiaHeaders(),
    })
    expect(res.status).toBe(301)
  })

  it('does not convert POST 302 to 303', async () => {
    const app = createApp()
    app.post('/submit', (c) => c.redirect('/result', 302))

    const res = await app.request('/submit', {
      method: 'POST',
      headers: inertiaHeaders(),
    })
    expect(res.status).toBe(302)
  })

  it('sets Vary header on converted 303 response', async () => {
    const app = createApp()
    app.put('/submit', (c) => c.redirect('/result', 302))

    const res = await app.request('/submit', {
      method: 'PUT',
      headers: inertiaHeaders(),
    })
    expect(res.status).toBe(303)
    expect(res.headers.get('Vary')).toContain('X-Inertia')
  })
})

// =========================================================================
// v3: sharedProps page object field
// =========================================================================
describe('Shared props metadata', () => {
  it('includes sharedProps keys from config-level share', async () => {
    const app = createApp({
      share: () => ({ appName: 'Test', auth: { user: null } }),
    })
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.sharedProps).toEqual(['appName', 'auth'])
  })

  it('includes sharedProps keys from per-request share', async () => {
    const app = createApp()
    app.get('/test', (c) => {
      c.var.inertia.share({ flash: 'success' })
      return c.var.inertia.render('Test')
    })

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.sharedProps).toEqual(['flash'])
  })

  it('combines config-level and per-request shared keys', async () => {
    const app = createApp({
      share: () => ({ appName: 'Test' }),
    })
    app.get('/test', (c) => {
      c.var.inertia.share({ flash: 'ok' })
      return c.var.inertia.render('Test')
    })

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.sharedProps).toEqual(['appName', 'flash'])
  })

  it('omits sharedProps when no sharing occurs', async () => {
    const app = createApp()
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.sharedProps).toBeUndefined()
  })
})

// =========================================================================
// v3: preserveFragment
// =========================================================================
describe('Preserve fragment', () => {
  it('includes preserveFragment when enabled', async () => {
    const app = createApp()
    app.get('/test', (c) => {
      c.var.inertia.preserveFragment()
      return c.var.inertia.render('Test')
    })

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.preserveFragment).toBe(true)
  })

  it('omits preserveFragment by default', async () => {
    const app = createApp()
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.preserveFragment).toBeUndefined()
  })

  it('can disable preserveFragment after enabling', async () => {
    const app = createApp()
    app.get('/test', (c) => {
      c.var.inertia.preserveFragment(true)
      c.var.inertia.preserveFragment(false)
      return c.var.inertia.render('Test')
    })

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.preserveFragment).toBeUndefined()
  })
})

// =========================================================================
// v3: redirect() with X-Inertia-Redirect header
// =========================================================================
describe('Fragment-preserving redirect', () => {
  it('returns 409 with X-Inertia-Redirect for Inertia requests', async () => {
    const app = createApp()
    app.get('/test', (c) => c.var.inertia.redirect('/new-page#section'))

    const res = await app.request('/test', { headers: inertiaHeaders() })
    expect(res.status).toBe(409)
    expect(res.headers.get('X-Inertia-Redirect')).toBe('/new-page#section')
    expect(res.headers.get('X-Inertia-Location')).toBeNull()
  })

  it('returns 302 for non-Inertia requests', async () => {
    const app = createApp()
    app.get('/test', (c) => c.var.inertia.redirect('/new-page#section'))

    const res = await app.request('/test', { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/new-page#section')
  })
})

// =========================================================================
// v3: scroll() prop
// =========================================================================
describe('Scroll props', () => {
  const mockMetadata: ScrollMetadata = {
    getPageName: () => 'page',
    getCurrentPage: () => 1,
    getPreviousPage: () => null,
    getNextPage: () => 2,
  }

  it('includes scroll data in props and scrollProps metadata', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        posts: scroll(() => [{ id: 1 }, { id: 2 }], mockMetadata),
      }),
    )

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.props.posts).toEqual([{ id: 1 }, { id: 2 }])
    expect(page.scrollProps).toEqual({
      posts: {
        pageName: 'page',
        currentPage: 1,
        previousPage: null,
        nextPage: 2,
        reset: true,
      },
    })
  })

  it('implicitly adds scroll prop to mergeProps', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        posts: scroll(() => [1, 2], mockMetadata),
      }),
    )

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.mergeProps).toEqual(['posts'])
  })

  it('routes scroll prop to prependProps on prepend merge intent', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        posts: scroll(() => [1, 2], mockMetadata),
      }),
    )

    const res = await app.request('/test', {
      headers: inertiaHeaders({
        'X-Inertia-Partial-Component': 'Test',
        'X-Inertia-Partial-Data': 'posts',
        'X-Inertia-Infinite-Scroll-Merge-Intent': 'prepend',
      }),
    })
    const page = await getPage(res)
    expect(page.prependProps).toEqual(['posts'])
    expect(page.mergeProps).toBeUndefined()
    // Incremental fetch (merge-intent header present) must not reset the collection
    expect(page.scrollProps?.posts?.reset).toBe(false)
  })

  it('respects partial reload filtering', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        posts: scroll(() => [1, 2], mockMetadata),
        other: 'data',
      }),
    )

    const res = await app.request('/test', {
      headers: inertiaHeaders({
        'X-Inertia-Partial-Component': 'Test',
        'X-Inertia-Partial-Data': 'other',
      }),
    })
    const page = await getPage(res)
    expect(page.props.other).toBe('data')
    expect(page.props.posts).toBeUndefined()
    expect(page.scrollProps).toBeUndefined()
  })

  it('excludes from mergeProps when reset', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        posts: scroll(() => [1], mockMetadata),
      }),
    )

    const res = await app.request('/test', {
      headers: inertiaHeaders({
        'X-Inertia-Reset': 'posts',
      }),
    })
    const page = await getPage(res)
    expect(page.props.posts).toEqual([1])
    expect(page.mergeProps).toBeUndefined()
  })
})

// =========================================================================
// Global history encryption config
// =========================================================================
describe('Global history encryption config', () => {
  it('encrypts history for every response when config.encryptHistory is true', async () => {
    const app = createApp({ encryptHistory: true })
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.encryptHistory).toBe(true)
  })

  it('allows a route to opt out of global history encryption', async () => {
    const app = createApp({ encryptHistory: true })
    app.get('/test', (c) => {
      c.var.inertia.encryptHistory(false)
      return c.var.inertia.render('Test')
    })

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.encryptHistory).toBeUndefined()
  })
})

// =========================================================================
// XSS safety: props are escaped in the data-page attribute
// =========================================================================
describe('XSS safety', () => {
  it('escapes script-breaking sequences from props in the data-page attribute', async () => {
    const payload = `</script><img src=x onerror="alert(1)">`
    const app = createApp()
    app.get('/test', (c) => c.var.inertia.render('Test', { bio: payload }))

    const res = await app.request('/test')
    const body = await res.text()

    // The raw breakout sequence must not survive into the document...
    expect(body).not.toContain('</script>')
    expect(body).not.toContain('onerror="alert(1)"')
    expect(body).toContain('&lt;/script&gt;')

    // ...but it round-trips back to the exact original value for the client.
    const page = parsePageFromHtml(body)
    expect(page.props.bio).toBe(payload)
  })
})

// =========================================================================
// Conformance: nested partial-reload keys
// =========================================================================
describe('Conformance: nested partial-reload keys', () => {
  it('includes the top-level prop when only a nested path is requested', async () => {
    const app = createApp()
    app.get('/test', (c) =>
      c.var.inertia.render('Test', {
        user: { name: 'Alice', email: 'a@b.c' },
        other: 'x',
      }),
    )

    const res = await app.request('/test', {
      headers: inertiaHeaders({
        'X-Inertia-Partial-Component': 'Test',
        'X-Inertia-Partial-Data': 'user.name',
      }),
    })
    const page = await getPage(res)
    expect(page.props.user).toEqual({ name: 'Alice', email: 'a@b.c' })
    expect(page.props.other).toBeUndefined()
  })
})

// =========================================================================
// Conformance: version mismatch location
// =========================================================================
describe('Conformance: version mismatch location', () => {
  it('returns a relative path in X-Inertia-Location', async () => {
    const app = createApp({ version: '2.0' })
    app.get('/users/:id', (c) => c.var.inertia.render('Users/Show'))

    const res = await app.request('/users/42?tab=profile', {
      headers: { 'X-Inertia': 'true', 'X-Inertia-Version': '1.0' },
    })
    expect(res.status).toBe(409)
    expect(res.headers.get('X-Inertia-Location')).toBe('/users/42?tab=profile')
  })
})

// =========================================================================
// Flash messages
// =========================================================================
describe('Flash messages', () => {
  it('emits flash on Inertia JSON responses', async () => {
    const app = createApp()
    app.get('/test', (c) => {
      c.var.inertia.flash({ success: 'Saved!' })
      return c.var.inertia.render('Test')
    })

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.flash).toEqual({ success: 'Saved!' })
  })

  it('emits flash in the data-page attribute on initial visits', async () => {
    const app = createApp()
    app.get('/test', (c) => {
      c.var.inertia.flash({ toast: 'Hi' })
      return c.var.inertia.render('Test')
    })

    const res = await app.request('/test')
    const page = parsePageFromHtml(await res.text())
    expect(page.flash).toEqual({ toast: 'Hi' })
  })

  it('accumulates across multiple flash() calls', async () => {
    const app = createApp()
    app.get('/test', (c) => {
      c.var.inertia.flash({ a: 1 })
      c.var.inertia.flash({ b: 2 })
      return c.var.inertia.render('Test')
    })

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.flash).toEqual({ a: 1, b: 2 })
  })

  it('later flash() calls override earlier keys', async () => {
    const app = createApp()
    app.get('/test', (c) => {
      c.var.inertia.flash({ msg: 'first' })
      c.var.inertia.flash({ msg: 'second' })
      return c.var.inertia.render('Test')
    })

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.flash).toEqual({ msg: 'second' })
  })

  it('omits flash when none is set', async () => {
    const app = createApp()
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.flash).toBeUndefined()
  })

  it('keeps flash out of props', async () => {
    const app = createApp()
    app.get('/test', (c) => {
      c.var.inertia.flash({ success: 'Saved!' })
      return c.var.inertia.render('Test', { title: 'Home' })
    })

    const res = await app.request('/test', { headers: inertiaHeaders() })
    const page = await getPage(res)
    expect(page.props.success).toBeUndefined()
    expect(page.props.title).toBe('Home')
  })
})
