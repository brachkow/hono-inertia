import type { Context } from 'hono'
import { routePath } from 'hono/route'
import { PROP_TYPE } from './symbols.js'
import type {
  DeferredProp,
  DevtoolsBodyCapture,
  DevtoolsConfig,
  DevtoolsEntry,
  DevtoolsPropMeta,
  DevtoolsRequestType,
  DevtoolsStore,
  MergeProp,
  MergeStrategy,
  OptionalProp,
  PageObject,
  ScrollProp,
  TaggedProp,
} from './types.js'
import { escapeHtml, stringifyPage } from './serialize.js'
import {
  getPartialComponent,
  getResetProps,
  getScrollMergeIntent,
  isInertiaRequest,
  isPrefetch,
} from './utils.js'

// Protocol: https://inertiajs.com/docs/devtools-protocol
export const DEVTOOLS_ID_HEADER = 'X-Inertia-Devtools-Id'
export const DEVTOOLS_PARENT_OUT_HEADER = 'X-Inertia-Devtools-Parent-Out'
export const DEVTOOLS_BASE_PATH_HEADER = 'X-Inertia-Devtools-Base-Path'
const PARENT_HEADER = 'X-Inertia-Devtools-Parent'
const TAB_HEADER = 'X-Inertia-Devtools-Tab'
const VISIT_HEADER = 'X-Inertia-Devtools-Visit'
const DEFERRED_HEADER = 'X-Inertia-Devtools-Deferred'
const POLL_HEADER = 'X-Inertia-Devtools-Poll'

const ENTRIES_PATH = '/_inertia/devtools/entries'
const RAW_BODY_LIMIT = 256_000
const REDACTED = '[REDACTED]'
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const NO_STORE = { 'Cache-Control': 'no-store' }

const DEFAULT_REDACT_KEYS = [
  'password',
  'password_confirmation',
  'current_password',
  'token',
  '_token',
  'access_token',
  'refresh_token',
  'secret',
  'client_secret',
  'api_key',
]

const DEFAULT_REDACT_HEADERS = [
  'cookie',
  'set-cookie',
  'authorization',
  'proxy-authorization',
  'x-xsrf-token',
  'x-csrf-token',
]

export interface DevtoolsOptions {
  store: DevtoolsStore
  authorize: (c: Context) => boolean | Promise<boolean>
  basePath: string
  redactKeys: Set<string>
  redactHeaders: Set<string>
  componentPath: (component: string) => string | null
}

// What render() captured for the recorder: the page as sent plus the wrapper
// behind each included top-level prop, so the entry can classify them.
export interface DevtoolsPayload {
  component: string
  page: PageObject
  propTags: Record<string, TaggedProp | undefined>
  rescuedProps: string[]
  sharedKeys: string[]
}

export interface DevtoolsRecording {
  startedAt: number
  // Cloned before the handler runs: the handler consumes the original body.
  body: Request | null
}

export function resolveDevtools(
  config: boolean | DevtoolsConfig | undefined,
): DevtoolsOptions | null {
  if (!config) return null
  const options = config === true ? {} : config
  const lower = (keys: string[]) => new Set(keys.map((key) => key.toLowerCase()))
  return {
    store: options.store ?? createMemoryDevtoolsStore(),
    authorize: options.authorize ?? (() => true),
    basePath: options.basePath ?? '',
    redactKeys: lower(options.redact?.keys ?? DEFAULT_REDACT_KEYS),
    redactHeaders: lower(options.redact?.headers ?? DEFAULT_REDACT_HEADERS),
    componentPath: options.componentPath ?? (() => null),
  }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 100
const DEFAULT_TTL = 24 * 60 * 60 * 1000

export function createMemoryDevtoolsStore(
  options: { limit?: number; ttl?: number } = {},
): DevtoolsStore {
  const limit = options.limit ?? DEFAULT_LIMIT
  const ttl = options.ttl ?? DEFAULT_TTL
  const entries = new Map<string, DevtoolsEntry>()
  const newestFirst = () =>
    [...entries.values()].sort((a, b) => b.__meta.utime - a.__meta.utime)

  return {
    set(entry) {
      const cutoff = (Date.now() - ttl) / 1000
      for (const [id, existing] of entries) {
        if (existing.__meta.utime < cutoff) entries.delete(id)
      }
      entries.set(entry.__meta.id, entry)
      // Capped per tab so a busy tab cannot evict another tab's history.
      if (entry.__meta.tabUuid === null || limit <= 0) return
      newestFirst()
        .filter((existing) => existing.__meta.tabUuid === entry.__meta.tabUuid)
        .slice(limit)
        .forEach((stale) => entries.delete(stale.__meta.id))
    },
    get(id) {
      return entries.get(id)
    },
    all() {
      return newestFirst()
    },
  }
}

// ---------------------------------------------------------------------------
// Read API
// ---------------------------------------------------------------------------

export async function handleDevtoolsRequest(
  c: Context,
  options: DevtoolsOptions,
): Promise<Response | null> {
  const prefix = `${options.basePath}${ENTRIES_PATH}`
  const path = c.req.path
  const isIndex = path === prefix
  const isShow = path.startsWith(`${prefix}/`)
  if (!isIndex && !isShow) return null
  if (c.req.method !== 'GET') return c.json({ message: 'Not found.' }, 404, NO_STORE)
  if (!(await options.authorize(c))) {
    return c.json({ message: 'Forbidden.' }, 403, NO_STORE)
  }
  if (isIndex) {
    return c.json(filterEntries(await options.store.all(), c), 200, NO_STORE)
  }
  const entry = await options.store.get(entryId(path.slice(prefix.length + 1)))
  if (!entry) return c.json({ message: 'Not found.' }, 404, NO_STORE)
  return c.json(entry, 200, NO_STORE)
}

function entryId(segment: string): string {
  try {
    const id = decodeURIComponent(segment)
    return id.includes('/') ? '' : id
  } catch {
    return ''
  }
}

function filterEntries(entries: DevtoolsEntry[], c: Context): DevtoolsEntry[] {
  const query = c.req.query()
  const csv = (value: string | undefined) =>
    (value ?? '').split(',').map((item) => item.trim()).filter(Boolean)
  const include = csv(query.type)
  const exclude = csv(query.exclude)
  const offset = Math.max(0, Number.parseInt(query.offset ?? '', 10) || 0)
  const limit = Number.parseInt(query.limit ?? '', 10)

  let list = entries
  if (query.component) list = list.filter((entry) => entry.__meta.component === query.component)
  if (include.length > 0) list = list.filter((entry) => include.includes(entry.__meta.requestType))
  if (exclude.length > 0) list = list.filter((entry) => !exclude.includes(entry.__meta.requestType))
  if (offset > 0) list = list.slice(offset)
  if (Number.isFinite(limit)) list = list.slice(0, Math.max(1, limit))
  return list
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

export function beginDevtoolsRecording(c: Context): DevtoolsRecording {
  const hasBody =
    WRITE_METHODS.has(c.req.method) && isInertiaRequest(c) && c.req.raw.body !== null
  return {
    startedAt: performance.now(),
    body: hasBody ? c.req.raw.clone() : null,
  }
}

// A passive observer: nothing here may turn the user's response into an error,
// so any failure drops the entry instead.
export async function recordDevtoolsEntry(
  c: Context,
  options: DevtoolsOptions,
  recording: DevtoolsRecording,
  payload: DevtoolsPayload | null,
): Promise<void> {
  try {
    const id = crypto.randomUUID()
    const batchId = isInertiaRequest(c) ? readHeader(c, PARENT_HEADER) : null
    // A prefetch is speculative and must not advance the batch cursor.
    const parentOut = isPrefetch(c) ? id : (batchId ?? id)

    c.res.headers.set(DEVTOOLS_ID_HEADER, id)
    c.res.headers.set(DEVTOOLS_PARENT_OUT_HEADER, parentOut)
    if (options.basePath !== '') {
      c.res.headers.set(DEVTOOLS_BASE_PATH_HEADER, options.basePath)
    }

    if (isInitialHtmlResponse(c, payload)) {
      await injectIdTag(c, id, options.basePath)
    }

    await options.store.set(await buildEntry(c, options, recording, payload, id, batchId))
  } catch {}
}

// The extension observes the first document load through the DOM rather than
// fetch, so the id has to be in the HTML. Plain HTML pages are left alone: the
// tag would read as an Inertia page there.
function isInitialHtmlResponse(c: Context, payload: DevtoolsPayload | null): boolean {
  if (isInertiaRequest(c) || payload === null || c.res.status !== 200) return false
  return (c.res.headers.get('Content-Type') ?? '').toLowerCase().includes('text/html')
}

async function injectIdTag(c: Context, id: string, basePath: string): Promise<void> {
  const html = await c.res.clone().text()
  const index = html.lastIndexOf('</body>')
  if (index === -1) return
  const basePathAttribute =
    basePath === '' ? '' : ` data-inertia-devtools-base-path="${escapeHtml(basePath)}"`
  const tag = `<script data-inertia-devtools-id${basePathAttribute} type="application/json">${JSON.stringify(id)}</script>`
  const headers = new Headers(c.res.headers)
  headers.delete('Content-Length')
  c.res = new Response(html.slice(0, index) + tag + html.slice(index), {
    status: c.res.status,
    statusText: c.res.statusText,
    headers,
  })
}

let lastUtime = 0

// Strictly increasing within an isolate: the panel orders and groups by utime.
function nextUtime(now: number): number {
  lastUtime = Math.max(now / 1000, lastUtime + 0.000001)
  return lastUtime
}

async function buildEntry(
  c: Context,
  options: DevtoolsOptions,
  recording: DevtoolsRecording,
  payload: DevtoolsPayload | null,
  id: string,
  batchId: string | null,
): Promise<DevtoolsEntry> {
  const now = Date.now()
  // The page as the client received it: a JSON round trip drops undefined
  // values, applies toJSON and writes BigInt markers, matching the wire.
  const page: PageObject | null = payload ? JSON.parse(stringifyPage(payload.page)) : null

  return {
    __meta: {
      id,
      tabUuid: readHeader(c, TAB_HEADER),
      batchId,
      timestamp: new Date(now).toISOString(),
      utime: nextUtime(now),
      method: c.req.method,
      url: redactUrl(c.req.url, options.redactKeys),
      component: payload?.component ?? null,
      requestType: resolveRequestType(c, payload !== null),
      status: c.res.status,
      redirectLocation: resolveRedirectLocation(c.res),
      serverTimingMs: Math.round((performance.now() - recording.startedAt) * 1000) / 1000,
      visitId: readHeader(c, VISIT_HEADER),
    },
    http: {
      requestHeaders: redactHeaders(c.req.raw.headers, options.redactHeaders),
      responseHeaders: redactHeaders(c.res.headers, options.redactHeaders),
      requestBody: await captureRequestBody(c, recording.body, options.redactKeys),
      responseBody: page
        ? { status: 'present', value: redactValue(page, options.redactKeys) }
        : await captureRawResponseBody(c.res, options.redactKeys),
    },
    props: payload ? buildPropMeta(c, payload) : {},
    propValues:
      payload && page
        ? redactValue(
            Object.fromEntries(
              Object.keys(payload.propTags).map((key) => [key, page.props[key]]),
            ),
            options.redactKeys,
          )
        : {},
    route: { name: null, uri: routePath(c), action: null },
    renderSource: null,
    componentPath: payload ? options.componentPath(payload.component) : null,
  }
}

function readHeader(c: Context, name: string): string | null {
  const value = c.req.header(name)
  return value ? value : null
}

function resolveRequestType(c: Context, renderedPage: boolean): DevtoolsRequestType {
  if (c.req.header('Precognition')) return 'precognition'
  if (!isInertiaRequest(c)) return renderedPage ? 'initial' : 'http'
  if (c.req.header(DEFERRED_HEADER)) return 'deferred'
  if (c.req.header(POLL_HEADER)) return 'poll'
  if (getPartialComponent(c) !== null) return 'partial'
  if (isPrefetch(c)) return 'prefetch'
  return 'navigate'
}

function resolveRedirectLocation(res: Response): string | null {
  const inertiaLocation =
    res.headers.get('X-Inertia-Location') ?? res.headers.get('X-Inertia-Redirect')
  if (inertiaLocation) return inertiaLocation
  if (res.status < 300 || res.status >= 400) return null
  return res.headers.get('Location') || null
}

// ---------------------------------------------------------------------------
// Prop metadata
// ---------------------------------------------------------------------------

function buildPropMeta(c: Context, payload: DevtoolsPayload): Record<string, DevtoolsPropMeta> {
  // A deferred prop only reads as deferred when delivered by the client's
  // deferred follow-up; on a manual partial reload it is a plain prop.
  const deferredDelivery = c.req.header(DEFERRED_HEADER) !== undefined
  const scrollDirection = getScrollMergeIntent(c)
  const resetProps = getResetProps(c)
  const rescued = new Set(payload.rescuedProps)

  const mergeMeta = (strategy: MergeStrategy, matchOn: string | null): Partial<DevtoolsPropMeta> => ({
    mergeDirection: strategy === 'prepend' ? 'prepend' : 'append',
    ...((strategy === 'deep' || matchOn !== null) && { deepMerge: true }),
  })

  const classifiers: Record<TaggedProp[typeof PROP_TYPE], (tag: TaggedProp) => Partial<DevtoolsPropMeta>> = {
    always: () => ({ inertiaType: 'always' }),
    optional: (tag) => ({
      inertiaType: 'optional',
      ...((tag as OptionalProp).isOnce && { once: true }),
    }),
    deferred: (tag) => {
      const deferred = tag as DeferredProp
      return {
        inertiaType: deferredDelivery ? 'defer' : null,
        ...(deferredDelivery && { deferGroup: deferred.group }),
        ...(deferred.isOnce && { once: true }),
        ...(deferred.isMerge && mergeMeta(deferred.mergeStrategy, deferred.matchOn)),
      }
    },
    merge: (tag) => ({
      inertiaType: 'merge',
      ...mergeMeta((tag as MergeProp).strategy, (tag as MergeProp).matchOn),
    }),
    once: () => ({ inertiaType: 'once', once: true }),
    scroll: (tag) => ({
      inertiaType: 'scroll',
      ...mergeMeta(scrollDirection, (tag as ScrollProp).matchOn),
    }),
  }

  const props: Record<string, DevtoolsPropMeta> = {}
  for (const [key, tag] of Object.entries(payload.propTags)) {
    props[key] = {
      shared: payload.sharedKeys.includes(key),
      inertiaType: null,
      ...(tag && classifiers[tag[PROP_TYPE]](tag)),
      ...(resetProps.has(key) && { reset: true }),
      ...(rescued.has(key) && { rescued: true }),
    }
  }
  return props
}

// ---------------------------------------------------------------------------
// Bodies, headers, redaction
// ---------------------------------------------------------------------------

async function captureRequestBody(
  c: Context,
  body: Request | null,
  redactKeys: Set<string>,
): Promise<DevtoolsBodyCapture> {
  if (!WRITE_METHODS.has(c.req.method)) return { status: 'empty' }
  if (!isInertiaRequest(c)) return { status: 'omitted', reason: 'non-inertia-request' }
  if (body === null) return { status: 'empty' }
  if (Number(c.req.header('Content-Length')) > RAW_BODY_LIMIT) {
    return { status: 'omitted', reason: 'too-large' }
  }

  const type = (c.req.header('Content-Type') ?? '').toLowerCase()
  if (type.includes('json')) {
    const text = await body.text()
    if (text === '') return { status: 'empty' }
    try {
      return { status: 'present', value: redactValue(JSON.parse(text), redactKeys) }
    } catch {
      return { status: 'present', value: text }
    }
  }
  if (type.includes('multipart/form-data') || type.includes('application/x-www-form-urlencoded')) {
    const data = summarizeFormData(await body.formData())
    if (Object.keys(data).length === 0) return { status: 'empty' }
    return { status: 'present', value: redactValue(data, redactKeys) }
  }

  const buffer = await body.arrayBuffer()
  if (buffer.byteLength === 0) return { status: 'empty' }
  if (buffer.byteLength > RAW_BODY_LIMIT) return { status: 'omitted', reason: 'too-large' }
  try {
    return { status: 'present', value: new TextDecoder('utf-8', { fatal: true }).decode(buffer) }
  } catch {
    return { status: 'omitted', reason: 'binary' }
  }
}

// Uploads become a lightweight summary so binary content never lands in an entry.
function summarizeFormData(form: FormData): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  form.forEach((value, key) => {
    const summarized =
      typeof value === 'string'
        ? value
        : { name: value.name, size: value.size, mimeType: value.type }
    const existing = data[key]
    data[key] =
      existing === undefined
        ? summarized
        : [...(Array.isArray(existing) ? existing : [existing]), summarized]
  })
  return data
}

async function captureRawResponseBody(
  res: Response,
  redactKeys: Set<string>,
): Promise<DevtoolsBodyCapture> {
  if (res.body === null) return { status: 'empty' }
  const type = (res.headers.get('Content-Type') ?? '').toLowerCase()
  if (!['json', 'text/', 'xml', 'javascript'].some((needle) => type.includes(needle))) {
    return { status: 'omitted', reason: 'non-textual' }
  }
  if (res.headers.get('Transfer-Encoding') === 'chunked' || type.includes('text/event-stream')) {
    return { status: 'omitted', reason: 'streamed' }
  }
  if (Number(res.headers.get('Content-Length')) > RAW_BODY_LIMIT) {
    return { status: 'omitted', reason: 'too-large' }
  }

  const text = await res.clone().text()
  if (text === '') return { status: 'empty' }
  if (text.length > RAW_BODY_LIMIT) return { status: 'omitted', reason: 'too-large' }
  if (type.includes('json')) {
    try {
      return { status: 'present', value: redactValue(JSON.parse(text), redactKeys) }
    } catch {}
  }
  return { status: 'present', value: text }
}

function redactHeaders(headers: Headers, sensitive: Set<string>): Record<string, string> {
  const result: Record<string, string> = {}
  headers.forEach((value, name) => {
    result[name] = sensitive.has(name) ? REDACTED : value
  })
  return result
}

function redactValue<T>(value: T, keys: Set<string>): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, keys)) as T
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        keys.has(key.toLowerCase()) ? REDACTED : redactValue(item, keys),
      ]),
    ) as T
  }
  return value
}

// Sensitive query parameters are redacted in place; the rest of the URL is kept.
// An unparseable URL is returned as-is: redaction must never break recording.
function redactUrl(url: string, keys: Set<string>): string {
  if (!url.includes('?')) return url
  try {
    const parsed = new URL(url)
    for (const key of [...parsed.searchParams.keys()]) {
      // `filter[secret]` matches on its innermost segment.
      const leaf = key.match(/\[([^\]]*)\]$/)?.[1] ?? key
      if (keys.has(key.toLowerCase()) || keys.has(leaf.toLowerCase())) {
        parsed.searchParams.set(key, REDACTED)
      }
    }
    return parsed.toString()
  } catch {
    return url
  }
}
