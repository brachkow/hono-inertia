import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { inertia } from '../src/middleware.js'
import { createMemoryDevtoolsStore } from '../src/devtools.js'
import { always, deferred, merge, once, optional, scroll } from '../src/props.js'
import { serializePage } from '../src/serialize.js'
import type {
  DevtoolsConfig,
  DevtoolsEntry,
  DevtoolsStore,
  InertiaConfig,
  InertiaEnv,
  ScrollMetadata,
} from '../src/types.js'

type AppConfig = Partial<Omit<InertiaConfig, 'devtools'>>

function createApp(devtools: DevtoolsConfig = {}, config: AppConfig = {}) {
  const store = createMemoryDevtoolsStore()
  const app = new Hono<InertiaEnv>()
  app.use(
    inertia({
      version: '1.0',
      render: (page) =>
        `<!DOCTYPE html><html><body><script data-page="app" type="application/json">${serializePage(page)}</script><div id="app"></div></body></html>`,
      devtools: { store, ...devtools },
      ...config,
    }),
  )
  return { app, store }
}

function inertiaHeaders(extra: Record<string, string> = {}) {
  return { 'X-Inertia': 'true', 'X-Inertia-Version': '1.0', ...extra }
}

async function lastEntry(store: DevtoolsStore): Promise<DevtoolsEntry> {
  const [entry] = await store.all()
  if (!entry) throw new Error('no entry recorded')
  return entry
}

function fakeEntry(overrides: Partial<DevtoolsEntry['__meta']>): DevtoolsEntry {
  return {
    __meta: {
      id: overrides.id ?? crypto.randomUUID(),
      tabUuid: null,
      batchId: null,
      timestamp: new Date().toISOString(),
      utime: Date.now() / 1000,
      method: 'GET',
      url: 'http://localhost/',
      component: null,
      requestType: 'http',
      status: 200,
      redirectLocation: null,
      serverTimingMs: 0,
      visitId: null,
      ...overrides,
    },
    http: {
      requestHeaders: {},
      responseHeaders: {},
      requestBody: { status: 'empty' },
      responseBody: { status: 'empty' },
    },
    props: {},
    propValues: {},
    route: { name: null, uri: '', action: null },
    renderSource: null,
    componentPath: null,
  }
}

const scrollMetadata: ScrollMetadata = {
  getPageName: () => 'page',
  getCurrentPage: () => 1,
  getPreviousPage: () => null,
  getNextPage: () => 2,
}

// =========================================================================
// Discovery
// =========================================================================
describe('DevTools discovery', () => {
  it('stamps the entry id and parent-out headers on every response', async () => {
    const { app, store } = createApp()
    app.get('/page', (c) => c.var.inertia.render('Test'))
    app.get('/plain', (c) => c.text('ok'))

    for (const [path, headers] of [
      ['/page', inertiaHeaders()],
      ['/page', {}],
      ['/plain', {}],
    ] as const) {
      const res = await app.request(path, { headers })
      const id = res.headers.get('X-Inertia-Devtools-Id')
      expect(id).toBeTruthy()
      expect(res.headers.get('X-Inertia-Devtools-Parent-Out')).toBe(id)
      expect((await lastEntry(store)).__meta.id).toBe(id)
    }
  })

  it('records nothing when devtools is off', async () => {
    const app = new Hono<InertiaEnv>()
    app.use(inertia({ version: '1.0', render: () => '<body></body>' }))
    app.get('/page', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/page')
    expect(res.headers.get('X-Inertia-Devtools-Id')).toBeNull()
    expect(await res.text()).not.toContain('data-inertia-devtools-id')
  })

  it('injects the id script tag before </body> on the initial page load', async () => {
    const { app } = createApp()
    app.get('/page', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/page')
    const id = res.headers.get('X-Inertia-Devtools-Id')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/html')
    expect(await res.text()).toContain(
      `<script data-inertia-devtools-id type="application/json">"${id}"</script></body>`,
    )
  })

  it('does not inject the tag into Inertia JSON or into HTML that is not an Inertia page', async () => {
    const { app } = createApp()
    app.get('/page', (c) => c.var.inertia.render('Test'))
    app.get('/plain', (c) => c.html('<html><body>hi</body></html>'))

    const json = await app.request('/page', { headers: inertiaHeaders() })
    expect(await json.text()).not.toContain('data-inertia-devtools-id')

    const plain = await app.request('/plain')
    expect(await plain.text()).toBe('<html><body>hi</body></html>')
  })

  it('reports the base path in the header and the tag when the app is served from a sub-path', async () => {
    const { app } = createApp({ basePath: '/portal' })
    app.get('/portal/page', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/portal/page')
    expect(res.headers.get('X-Inertia-Devtools-Base-Path')).toBe('/portal')
    expect(await res.text()).toContain(
      '<script data-inertia-devtools-id data-inertia-devtools-base-path="/portal" type="application/json">',
    )
  })

  it('keeps the original headers on the rewritten initial response', async () => {
    const { app } = createApp()
    app.get('/page', (c) => {
      c.header('X-Custom', 'yes')
      return c.var.inertia.render('Test')
    })

    const res = await app.request('/page')
    expect(res.headers.get('X-Custom')).toBe('yes')
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache, must-revalidate')
    expect(res.headers.get('Vary')).toBe('X-Inertia')
  })
})

// =========================================================================
// Read API
// =========================================================================
describe('DevTools read API', () => {
  it('serves a recorded entry by id and 404s unknown ids', async () => {
    const { app } = createApp()
    app.get('/page', (c) => c.var.inertia.render('Test'))

    const id = (await app.request('/page')).headers.get('X-Inertia-Devtools-Id')
    const res = await app.request(`/_inertia/devtools/entries/${id}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(((await res.json()) as DevtoolsEntry).__meta.id).toBe(id)

    const missing = await app.request('/_inertia/devtools/entries/nope')
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ message: 'Not found.' })

    expect((await app.request('/_inertia/devtools/entries/%E0%A4%A')).status).toBe(404)
    expect((await app.request('/_inertia/devtools/entries/a/b')).status).toBe(404)
  })

  it('does not record its own endpoints', async () => {
    const { app, store } = createApp()
    await app.request('/_inertia/devtools/entries')
    await app.request('/_inertia/devtools/entries/x')
    expect(await store.all()).toEqual([])
  })

  it('lists entries newest first with component, type, exclude, offset and limit filters', async () => {
    const { app } = createApp()
    app.get('/a', (c) => c.var.inertia.render('A'))
    app.get('/b', (c) => c.var.inertia.render('B'))

    await app.request('/a')
    await app.request('/b', { headers: inertiaHeaders() })
    await app.request('/b', { headers: inertiaHeaders({ 'X-Inertia-Devtools-Poll': '1' }) })

    const list = async (query = '') =>
      (await (await app.request(`/_inertia/devtools/entries${query}`)).json()) as DevtoolsEntry[]

    expect((await list()).map((entry) => entry.__meta.requestType)).toEqual([
      'poll',
      'navigate',
      'initial',
    ])
    expect((await list('?component=A')).map((entry) => entry.__meta.component)).toEqual(['A'])
    expect((await list('?type=poll,initial')).length).toBe(2)
    expect((await list('?exclude=poll')).map((entry) => entry.__meta.requestType)).toEqual([
      'navigate',
      'initial',
    ])
    expect((await list('?offset=1&limit=1')).map((entry) => entry.__meta.requestType)).toEqual([
      'navigate',
    ])
  })

  it('rejects unauthorized requests with 403', async () => {
    const authorize = vi.fn((c) => c.req.header('X-Dev') === 'yes')
    const { app } = createApp({ authorize })

    expect((await app.request('/_inertia/devtools/entries')).status).toBe(403)
    expect(
      (await app.request('/_inertia/devtools/entries', { headers: { 'X-Dev': 'yes' } })).status,
    ).toBe(200)
    expect(authorize).toHaveBeenCalledTimes(2)
  })

  it('only answers GET', async () => {
    const { app } = createApp()
    expect((await app.request('/_inertia/devtools/entries', { method: 'POST' })).status).toBe(404)
  })

  it('mounts the endpoints under the base path', async () => {
    const { app } = createApp({ basePath: '/portal' })
    app.get('/portal/page', (c) => c.var.inertia.render('Test'))

    const id = (await app.request('/portal/page')).headers.get('X-Inertia-Devtools-Id')
    expect((await app.request(`/portal/_inertia/devtools/entries/${id}`)).status).toBe(200)
    expect((await app.request(`/_inertia/devtools/entries/${id}`)).status).toBe(404)
  })

  it('works with an async custom store', async () => {
    const entries: DevtoolsEntry[] = []
    const store: DevtoolsStore = {
      set: async (entry) => {
        entries.push(entry)
      },
      get: async (id) => entries.find((entry) => entry.__meta.id === id),
      all: async () => [...entries].reverse(),
    }
    const { app } = createApp({ store })
    app.get('/page', (c) => c.var.inertia.render('Test'))

    const id = (await app.request('/page')).headers.get('X-Inertia-Devtools-Id')
    expect((await app.request(`/_inertia/devtools/entries/${id}`)).status).toBe(200)
    expect((await (await app.request('/_inertia/devtools/entries')).json()) as unknown[]).toHaveLength(1)
  })
})

// =========================================================================
// Request type derivation
// =========================================================================
describe('DevTools request types', () => {
  const setup = () => {
    const { app, store } = createApp({}, { onRescue: () => {} })
    app.get('/page', (c) =>
      c.var.inertia.render('Test', { comments: deferred(() => []) }),
    )
    app.get('/api', (c) => c.json({ ok: true }))
    return { app, store }
  }
  const partial = { 'X-Inertia-Partial-Component': 'Test', 'X-Inertia-Partial-Data': 'comments' }

  it.each([
    ['initial', '/page', {}],
    ['http', '/api', {}],
    ['navigate', '/page', inertiaHeaders()],
    ['partial', '/page', inertiaHeaders(partial)],
    ['deferred', '/page', inertiaHeaders({ ...partial, 'X-Inertia-Devtools-Deferred': '1' })],
    ['poll', '/page', inertiaHeaders({ ...partial, 'X-Inertia-Devtools-Poll': '1' })],
    ['prefetch', '/page', inertiaHeaders({ Purpose: 'prefetch' })],
    ['precognition', '/page', inertiaHeaders({ ...partial, Precognition: 'true' })],
  ])('classifies %s', async (type, path, headers) => {
    const { app, store } = setup()
    await app.request(path, { headers })
    expect((await lastEntry(store)).__meta.requestType).toBe(type)
  })
})

// =========================================================================
// Lineage and meta
// =========================================================================
describe('DevTools lineage', () => {
  it('records the incoming parent as batchId and echoes it as parent-out', async () => {
    const { app, store } = createApp()
    app.get('/page', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/page', {
      headers: inertiaHeaders({
        'X-Inertia-Devtools-Parent': 'root',
        'X-Inertia-Devtools-Tab': 'tab-1',
        'X-Inertia-Devtools-Visit': 'visit-1',
      }),
    })
    const entry = await lastEntry(store)
    expect(res.headers.get('X-Inertia-Devtools-Parent-Out')).toBe('root')
    expect(entry.__meta.batchId).toBe('root')
    expect(entry.__meta.tabUuid).toBe('tab-1')
    expect(entry.__meta.visitId).toBe('visit-1')
  })

  it('ignores the parent header on non-Inertia requests', async () => {
    const { app, store } = createApp()
    app.get('/page', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/page', { headers: { 'X-Inertia-Devtools-Parent': 'root' } })
    const entry = await lastEntry(store)
    expect(entry.__meta.batchId).toBeNull()
    expect(entry.__meta.tabUuid).toBeNull()
    expect(res.headers.get('X-Inertia-Devtools-Parent-Out')).toBe(entry.__meta.id)
  })

  it('answers a prefetch with its own id as parent-out', async () => {
    const { app, store } = createApp()
    app.get('/page', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/page', {
      headers: inertiaHeaders({ Purpose: 'prefetch', 'X-Inertia-Devtools-Parent': 'root' }),
    })
    const entry = await lastEntry(store)
    expect(res.headers.get('X-Inertia-Devtools-Parent-Out')).toBe(entry.__meta.id)
    expect(entry.__meta.batchId).toBe('root')
  })
})

describe('DevTools entry meta', () => {
  it('records method, absolute url, status, timing and timestamps', async () => {
    const { app, store } = createApp()
    app.post('/items', (c) => c.var.inertia.render('Items'))

    const before = Date.now() / 1000
    await app.request('http://localhost/items?q=1', { method: 'POST', headers: inertiaHeaders() })
    const { __meta } = await lastEntry(store)

    expect(__meta.method).toBe('POST')
    expect(__meta.url).toBe('http://localhost/items?q=1')
    expect(__meta.status).toBe(200)
    expect(__meta.component).toBe('Items')
    expect(__meta.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(__meta.utime).toBeGreaterThanOrEqual(before)
    expect(__meta.utime).toBeLessThanOrEqual(Date.now() / 1000 + 0.001)
    expect(__meta.serverTimingMs).toBeGreaterThanOrEqual(0)
  })

  it('orders consecutive entries by strictly increasing utime', async () => {
    const { app, store } = createApp()
    app.get('/page', (c) => c.var.inertia.render('Test'))

    await app.request('/page')
    await app.request('/page')
    const [second, first] = await store.all()
    expect(second.__meta.utime).toBeGreaterThan(first.__meta.utime)
  })

  it('redacts sensitive query parameters in the url', async () => {
    const { app, store } = createApp()
    app.get('/page', (c) => c.text('ok'))

    await app.request('/page?token=abc&q=1&filter[secret]=x')
    expect((await lastEntry(store)).__meta.url).toBe(
      'http://localhost/page?token=%5BREDACTED%5D&q=1&filter%5Bsecret%5D=%5BREDACTED%5D',
    )
  })

  it('records redirect targets for 3xx and Inertia location responses', async () => {
    const { app, store } = createApp()
    app.post('/redirect', (c) => c.redirect('/elsewhere'))
    app.delete('/gone', (c) => c.redirect('/list'))
    app.post('/external', (c) => c.var.inertia.location('https://example.com'))
    app.post('/hash', (c) => c.var.inertia.redirect('/page#top'))
    app.get('/ok', (c) => c.text('ok'))

    await app.request('/redirect', { method: 'POST', headers: inertiaHeaders() })
    expect((await lastEntry(store)).__meta).toMatchObject({ status: 302, redirectLocation: '/elsewhere', requestType: 'navigate' })

    await app.request('/gone', { method: 'DELETE', headers: inertiaHeaders() })
    expect((await lastEntry(store)).__meta).toMatchObject({ status: 303, redirectLocation: '/list' })

    await app.request('/external', { method: 'POST', headers: inertiaHeaders() })
    expect((await lastEntry(store)).__meta).toMatchObject({ status: 409, redirectLocation: 'https://example.com' })

    await app.request('/hash', { method: 'POST', headers: inertiaHeaders() })
    expect((await lastEntry(store)).__meta).toMatchObject({ status: 409, redirectLocation: '/page#top' })

    await app.request('/ok')
    expect((await lastEntry(store)).__meta.redirectLocation).toBeNull()
  })

  it('records a version-mismatch 409', async () => {
    const { app, store } = createApp({}, { version: '2.0' })
    app.get('/page', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/page', { headers: inertiaHeaders() })
    expect(res.status).toBe(409)
    expect(res.headers.get('X-Inertia-Devtools-Id')).toBeTruthy()
    expect((await lastEntry(store)).__meta).toMatchObject({
      status: 409,
      redirectLocation: '/page',
      component: null,
    })
  })

  it('records the matched route path and resolves the component path', async () => {
    const { app, store } = createApp({ componentPath: (name) => `resources/js/Pages/${name}.vue` })
    app.get('/users/:id', (c) => c.var.inertia.render('Users/Show'))

    await app.request('/users/7')
    const entry = await lastEntry(store)
    expect(entry.route).toEqual({ name: null, uri: '/users/:id', action: null })
    expect(entry.renderSource).toBeNull()
    expect(entry.componentPath).toBe('resources/js/Pages/Users/Show.vue')
  })
})

// =========================================================================
// Props
// =========================================================================
describe('DevTools prop metadata', () => {
  const partial = (data: string) => ({
    'X-Inertia-Partial-Component': 'Test',
    'X-Inertia-Partial-Data': data,
  })

  it('classifies plain, shared, always, merge and once props', async () => {
    const { app, store } = createApp({}, { share: () => ({ auth: { user: 'me', password: 'x' } }) })
    app.get('/page', (c) =>
      c.var.inertia.render('Test', {
        plain: 1,
        errors: always({}),
        posts: merge([1]),
        prepended: merge([2]).prepend(),
        deep: merge({ a: 1 }).deepMerge(),
        matched: merge([{ id: 1 }]).setMatchOn('id'),
        settings: once(() => ({ theme: 'dark' })),
      }),
    )

    await app.request('/page', { headers: inertiaHeaders() })
    const entry = await lastEntry(store)
    expect(entry.props).toEqual({
      auth: { shared: true, inertiaType: null },
      plain: { shared: false, inertiaType: null },
      errors: { shared: false, inertiaType: 'always' },
      posts: { shared: false, inertiaType: 'merge', mergeDirection: 'append' },
      prepended: { shared: false, inertiaType: 'merge', mergeDirection: 'prepend' },
      deep: { shared: false, inertiaType: 'merge', mergeDirection: 'append', deepMerge: true },
      matched: { shared: false, inertiaType: 'merge', mergeDirection: 'append', deepMerge: true },
      settings: { shared: false, inertiaType: 'once', once: true },
    })
    expect(entry.propValues).toEqual({
      auth: { user: 'me', password: '[REDACTED]' },
      plain: 1,
      errors: {},
      posts: [1],
      prepended: [2],
      deep: { a: 1 },
      matched: [{ id: 1 }],
      settings: { theme: 'dark' },
    })
  })

  it('flags reset props and scroll direction from the request headers', async () => {
    const { app, store } = createApp()
    app.get('/page', (c) =>
      c.var.inertia.render('Test', {
        posts: merge([1]),
        feed: scroll([1], scrollMetadata).setMatchOn('id'),
      }),
    )

    await app.request('/page', {
      headers: inertiaHeaders({
        'X-Inertia-Reset': 'posts',
        'X-Inertia-Infinite-Scroll-Merge-Intent': 'prepend',
      }),
    })
    const entry = await lastEntry(store)
    expect(entry.props.posts).toEqual({ shared: false, inertiaType: 'merge', mergeDirection: 'append', reset: true })
    expect(entry.props.feed).toEqual({ shared: false, inertiaType: 'scroll', mergeDirection: 'prepend', deepMerge: true })
  })

  it('leaves unresolved optional and deferred props out, and classifies them once fetched', async () => {
    const { app, store } = createApp()
    app.get('/page', (c) =>
      c.var.inertia.render('Test', {
        stats: optional(() => 1).once(),
        comments: deferred(() => [], 'sidebar').merge(),
      }),
    )

    await app.request('/page', { headers: inertiaHeaders() })
    expect(Object.keys((await lastEntry(store)).props)).toEqual(['errors'])

    await app.request('/page', { headers: inertiaHeaders(partial('stats,comments')) })
    const manual = await lastEntry(store)
    expect(manual.props.stats).toEqual({ shared: false, inertiaType: 'optional', once: true })
    expect(manual.props.comments).toEqual({ shared: false, inertiaType: null, mergeDirection: 'append' })

    await app.request('/page', {
      headers: inertiaHeaders({ ...partial('comments'), 'X-Inertia-Devtools-Deferred': '1' }),
    })
    expect((await lastEntry(store)).props.comments).toEqual({
      shared: false,
      inertiaType: 'defer',
      deferGroup: 'sidebar',
      mergeDirection: 'append',
    })
  })

  it('flags rescued deferred props and records their null value', async () => {
    const { app, store } = createApp({}, { onRescue: () => {} })
    app.get('/page', (c) =>
      c.var.inertia.render('Test', {
        comments: deferred(() => {
          throw new Error('boom')
        }).rescue(),
      }),
    )

    await app.request('/page', {
      headers: inertiaHeaders({ ...partial('comments'), 'X-Inertia-Devtools-Deferred': '1' }),
    })
    const entry = await lastEntry(store)
    expect(entry.props.comments).toEqual({
      shared: false,
      inertiaType: 'defer',
      deferGroup: 'default',
      rescued: true,
    })
    expect(entry.propValues.comments).toBeNull()
  })

  it('records empty props for responses that rendered no page', async () => {
    const { app, store } = createApp()
    app.get('/api', (c) => c.json({ ok: true }))

    await app.request('/api')
    const entry = await lastEntry(store)
    expect(entry.props).toEqual({})
    expect(entry.propValues).toEqual({})
    expect(entry.componentPath).toBeNull()
  })
})

// =========================================================================
// HTTP capture
// =========================================================================
describe('DevTools HTTP capture', () => {
  it('records lowercase headers with sensitive ones redacted', async () => {
    const { app, store } = createApp()
    app.get('/page', (c) => c.var.inertia.render('Test'))

    await app.request('/page', {
      headers: inertiaHeaders({
        Authorization: 'Bearer secret',
        Cookie: 'sid=abc',
        'X-XSRF-TOKEN': 'csrf',
        Accept: 'application/json',
      }),
    })
    const { http } = await lastEntry(store)
    expect(http.requestHeaders).toMatchObject({
      'authorization': '[REDACTED]',
      'cookie': '[REDACTED]',
      'x-xsrf-token': '[REDACTED]',
      'accept': 'application/json',
      'x-inertia': 'true',
    })
    expect(http.responseHeaders['x-inertia-devtools-id']).toBe((await lastEntry(store)).__meta.id)
    expect(http.responseHeaders['content-type']).toContain('application/json')
  })

  it('captures a JSON request body the handler already consumed, redacted', async () => {
    const { app, store } = createApp()
    app.post('/login', async (c) => {
      const body = await c.req.json<{ email: string }>()
      return c.var.inertia.render('Login', { email: body.email })
    })

    await app.request('/login', {
      method: 'POST',
      headers: inertiaHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ email: 'a@b.c', password: 'hunter2', nested: { token: 't' } }),
    })
    expect((await lastEntry(store)).http.requestBody).toEqual({
      status: 'present',
      value: { email: 'a@b.c', password: '[REDACTED]', nested: { token: '[REDACTED]' } },
    })
  })

  it('summarizes uploaded files instead of serializing them', async () => {
    const { app, store } = createApp()
    app.post('/upload', async (c) => {
      await c.req.parseBody()
      return c.redirect('/done')
    })

    const form = new FormData()
    form.append('title', 'hello')
    form.append('avatar', new File(['binary'], 'me.png', { type: 'image/png' }))
    await app.request('/upload', { method: 'POST', headers: inertiaHeaders(), body: form })
    expect((await lastEntry(store)).http.requestBody).toEqual({
      status: 'present',
      value: { title: 'hello', avatar: { name: 'me.png', size: 6, mimeType: 'image/png' } },
    })
  })

  it('omits non-Inertia write bodies, keeps GETs empty, and marks binary bodies', async () => {
    const { app, store } = createApp()
    app.post('/raw', (c) => c.text('ok'))
    app.get('/page', (c) => c.text('ok'))

    await app.request('/raw', { method: 'POST', body: 'x' })
    expect((await lastEntry(store)).http.requestBody).toEqual({
      status: 'omitted',
      reason: 'non-inertia-request',
    })

    await app.request('/page?x=1')
    expect((await lastEntry(store)).http.requestBody).toEqual({ status: 'empty' })

    await app.request('/raw', {
      method: 'POST',
      headers: inertiaHeaders({ 'Content-Type': 'application/octet-stream' }),
      body: new Uint8Array([0xff, 0xfe, 0xfd]),
    })
    expect((await lastEntry(store)).http.requestBody).toEqual({ status: 'omitted', reason: 'binary' })

    await app.request('/raw', {
      method: 'POST',
      headers: inertiaHeaders({ 'Content-Type': 'application/json' }),
      body: '',
    })
    expect((await lastEntry(store)).http.requestBody).toEqual({ status: 'empty' })
  })

  it('records the page object as the response body of Inertia responses', async () => {
    const { app, store } = createApp()
    app.get('/page', (c) => c.var.inertia.render('Test', { secret: 's', n: 1 }))

    await app.request('/page', { headers: inertiaHeaders() })
    expect((await lastEntry(store)).http.responseBody).toEqual({
      status: 'present',
      value: { component: 'Test', props: { errors: {}, secret: '[REDACTED]', n: 1 }, url: '/page', version: '1.0' },
    })

    await app.request('/page')
    expect((await lastEntry(store)).http.responseBody).toMatchObject({
      status: 'present',
      value: { component: 'Test' },
    })
  })

  it('captures raw textual response bodies and omits the rest', async () => {
    const { app, store } = createApp()
    app.get('/json', (c) => c.json({ token: 'x', ok: true }))
    app.get('/text', (c) => c.text('hello'))
    app.get('/big', (c) => c.text('x'.repeat(300_000)))
    app.get('/png', (c) => c.body(new Uint8Array([1, 2]), 200, { 'Content-Type': 'image/png' }))
    app.get('/stream', (c) => {
      c.header('Transfer-Encoding', 'chunked')
      return c.text('chunk')
    })
    app.get('/redirect', (c) => c.redirect('/text'))

    const bodyOf = async (path: string) => {
      await app.request(path)
      return (await lastEntry(store)).http.responseBody
    }
    expect(await bodyOf('/json')).toEqual({ status: 'present', value: { token: '[REDACTED]', ok: true } })
    expect(await bodyOf('/text')).toEqual({ status: 'present', value: 'hello' })
    expect(await bodyOf('/big')).toEqual({ status: 'omitted', reason: 'too-large' })
    expect(await bodyOf('/png')).toEqual({ status: 'omitted', reason: 'non-textual' })
    expect(await bodyOf('/stream')).toEqual({ status: 'omitted', reason: 'streamed' })
    expect(await bodyOf('/redirect')).toEqual({ status: 'empty' })
  })

  it('uses configured redact lists instead of the defaults', async () => {
    const { app, store } = createApp({ redact: { keys: ['ssn'], headers: ['x-api-key'] } })
    app.get('/page', (c) => c.var.inertia.render('Test', { ssn: '1', password: 'kept' }))

    await app.request('/page', { headers: inertiaHeaders({ 'X-Api-Key': 'k', Cookie: 'kept' }) })
    const entry = await lastEntry(store)
    expect(entry.propValues).toMatchObject({ ssn: '[REDACTED]', password: 'kept' })
    expect(entry.http.requestHeaders).toMatchObject({ 'x-api-key': '[REDACTED]', 'cookie': 'kept' })
  })

  it('never fails the response when recording throws', async () => {
    const store: DevtoolsStore = {
      set: () => {
        throw new Error('disk full')
      },
      get: () => undefined,
      all: () => [],
    }
    const { app } = createApp({ store })
    app.get('/page', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/page', { headers: inertiaHeaders() })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { component: string }).component).toBe('Test')
  })
})

// =========================================================================
// Memory store
// =========================================================================
describe('createMemoryDevtoolsStore', () => {
  it('returns entries newest first', () => {
    const store = createMemoryDevtoolsStore()
    const now = Date.now() / 1000
    store.set(fakeEntry({ id: 'old', utime: now - 1 }))
    store.set(fakeEntry({ id: 'new', utime: now }))
    expect((store.all() as DevtoolsEntry[]).map((entry) => entry.__meta.id)).toEqual(['new', 'old'])
  })

  it('caps entries per tab without touching other tabs or untabbed entries', () => {
    const store = createMemoryDevtoolsStore({ limit: 2 })
    const now = Date.now() / 1000
    store.set(fakeEntry({ id: 'a1', tabUuid: 'a', utime: now - 5 }))
    store.set(fakeEntry({ id: 'b1', tabUuid: 'b', utime: now - 4 }))
    store.set(fakeEntry({ id: 'none', tabUuid: null, utime: now - 3 }))
    store.set(fakeEntry({ id: 'a2', tabUuid: 'a', utime: now - 2 }))
    store.set(fakeEntry({ id: 'a3', tabUuid: 'a', utime: now - 1 }))

    expect((store.all() as DevtoolsEntry[]).map((entry) => entry.__meta.id)).toEqual(['a3', 'a2', 'none', 'b1'])
    expect(store.get('a1')).toBeUndefined()
  })

  it('prunes entries older than the ttl', () => {
    const store = createMemoryDevtoolsStore({ ttl: 1000 })
    store.set(fakeEntry({ id: 'stale', utime: Date.now() / 1000 - 2 }))
    store.set(fakeEntry({ id: 'fresh' }))
    expect(store.get('stale')).toBeUndefined()
    expect(store.get('fresh')).toBeDefined()
  })
})
