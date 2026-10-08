import { describe, expect, it } from 'vitest'
import { Hono } from 'hono-4.0.0'
import { inertia } from '../src/middleware.js'
import { serializePage } from '../src/serialize.js'
import type { InertiaEnv } from '../src/types.js'

// The oldest Hono the peer range allows. Its Context drops the headers
// argument of body()/json() unless the status argument is a number.
const createApp = () => {
  const app = new Hono<InertiaEnv>()
  app.use(
    inertia({
      version: '1.0',
      render: (page) => `<script data-page="app" type="application/json">${serializePage(page)}</script><div id="app"></div>`,
    }),
  )
  return app
}

const inertiaHeaders = { 'X-Inertia': 'true', 'X-Inertia-Version': '1.0' }

describe('Hono 4.0.0', () => {
  it('marks Inertia responses with X-Inertia and a JSON content type', async () => {
    const app = createApp()
    app.get('/test', (c) => c.var.inertia.render('Test'))

    const res = await app.request('/test', { headers: inertiaHeaders })

    expect(res.headers.get('X-Inertia')).toBe('true')
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect(await res.json()).toMatchObject({ component: 'Test' })
  })

  it('uses c.status() on Inertia responses', async () => {
    const app = createApp()
    app.get('/missing', (c) => {
      c.status(404)
      return c.var.inertia.render('Error')
    })

    const res = await app.request('/missing', { headers: inertiaHeaders })

    expect(res.status).toBe(404)
    expect(res.headers.get('X-Inertia')).toBe('true')
  })
})
