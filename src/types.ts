import type { Context } from 'hono'

// ---------------------------------------------------------------------------
// Page object (sent to the Inertia client)
// ---------------------------------------------------------------------------

export interface PageObject {
  component: string
  props: Record<string, unknown>
  url: string
  version: string | null
  encryptHistory?: boolean
  clearHistory?: boolean
  preserveFragment?: boolean
  // Set while serializing when props hold a BigInt (see stringifyPage)
  preserveBigIntegers?: boolean
  sharedProps?: string[]
  flash?: Record<string, unknown>
  rescuedProps?: string[]
  deferredProps?: Record<string, string[]>
  mergeProps?: string[]
  prependProps?: string[]
  deepMergeProps?: string[]
  matchPropsOn?: string[]
  onceProps?: Record<string, { prop: string; expiresAt?: number | null }>
  scrollProps?: Record<string, {
    pageName: string
    previousPage: number | null
    nextPage: number | null
    currentPage: number
    reset: boolean
  }>
}

// ---------------------------------------------------------------------------
// SSR
// ---------------------------------------------------------------------------

// What an Inertia SSR entry's default export returns
export interface SsrRenderResult {
  head: string[]
  body: string
}

// Posts the page to `${url}/render` on an Inertia SSR server (`createServer`)
export interface SsrHttpConfig {
  enabled?: boolean
  url?: string
  // Abort the SSR request after this many ms (default 5000), falling back to CSR.
  timeout?: number
  // Reject SSR responses larger than this many bytes (default 2_000_000).
  maxResponseBytes?: number
  render?: never
}

// Renders in the same process, e.g. a Worker that imports the SSR entry
export interface SsrRenderConfig {
  enabled?: boolean
  render: (page: PageObject) => SsrRenderResult | Promise<SsrRenderResult>
  url?: never
  timeout?: never
  maxResponseBytes?: never
}

export type SsrConfig = SsrHttpConfig | SsrRenderConfig

export interface SsrResult {
  head: string
  body: string
}

// ---------------------------------------------------------------------------
// Render function (user-provided)
// ---------------------------------------------------------------------------

export type RenderFunction = (
  page: PageObject,
  viewData: Record<string, unknown>,
  ssr: SsrResult | undefined,
  c: Context,
) => string | Promise<string>

// ---------------------------------------------------------------------------
// Middleware configuration
// ---------------------------------------------------------------------------

export interface InertiaConfig {
  // Asset version. Omitting it disables version checks (page.version: null).
  // Keep the value short — the client echoes it back as a request header.
  version?: string | (() => string | Promise<string>)
  render: RenderFunction
  ssr?: SsrConfig
  share?: (c: Context) => Record<string, unknown> | Promise<Record<string, unknown>>
  // Encrypt browser history state for every response (mirrors Inertia's global
  // `history.encrypt` option). Off by default; pages can opt out per-request via
  // `c.var.inertia.encryptHistory(false)`. Requires the client to be served over HTTPS.
  encryptHistory?: boolean
  // Cache-Control for adapter-emitted responses (JSON, HTML, 409s). Defaults to
  // 'private, no-cache, must-revalidate'; set false to omit the header.
  cacheControl?: string | false
  // Called when a `deferred(fn).rescue()` prop throws while resolving. The prop
  // is sent as null and listed in `page.rescuedProps`. Defaults to console.error.
  onRescue?: (error: unknown, prop: string) => void
  // Called when SSR fails. The page then renders client-side (ssr is undefined
  // in render). Throw from it to fail the request instead. Defaults to console.error.
  onSsrError?: (error: unknown, page: PageObject) => void
  // Record requests for the Inertia DevTools browser extension. Off by default;
  // enable in development only. See README → DevTools.
  devtools?: boolean | DevtoolsConfig
}

// ---------------------------------------------------------------------------
// DevTools (https://inertiajs.com/docs/devtools-protocol)
// ---------------------------------------------------------------------------

export interface DevtoolsConfig {
  // Gate for the read endpoints. Every request is allowed when omitted, since
  // enabling devtools is already an explicit development switch.
  authorize?: (c: Context) => boolean | Promise<boolean>
  // Path the app is served from when it is not the origin root, e.g. '/portal'.
  basePath?: string
  // Prop/body keys and header names replaced with '[REDACTED]' in entries.
  // Each list replaces the default one.
  redact?: { keys?: string[]; headers?: string[] }
  // Where entries live. Defaults to an in-memory store per inertia() instance.
  store?: DevtoolsStore
  // Resolve a page component name to its source path for editor links.
  componentPath?: (component: string) => string | null
}

export interface DevtoolsStore {
  set(entry: DevtoolsEntry): void | Promise<void>
  get(id: string): DevtoolsEntry | undefined | Promise<DevtoolsEntry | undefined>
  // Newest first.
  all(): DevtoolsEntry[] | Promise<DevtoolsEntry[]>
}

export type DevtoolsRequestType =
  | 'navigate'
  | 'partial'
  | 'deferred'
  | 'poll'
  | 'prefetch'
  | 'initial'
  | 'http'
  | 'precognition'

export type DevtoolsBodyCapture =
  | { status: 'empty' }
  | { status: 'present'; value: unknown }
  | { status: 'omitted'; reason: string }

export interface DevtoolsPropMeta {
  shared: boolean
  inertiaType: 'always' | 'defer' | 'optional' | 'merge' | 'scroll' | 'once' | null
  deferGroup?: string
  reset?: boolean
  once?: boolean
  mergeDirection?: 'append' | 'prepend'
  deepMerge?: boolean
  rescued?: boolean
}

export interface DevtoolsEntry {
  __meta: {
    id: string
    tabUuid: string | null
    batchId: string | null
    timestamp: string
    utime: number
    method: string
    url: string
    component: string | null
    requestType: DevtoolsRequestType
    status: number
    redirectLocation: string | null
    serverTimingMs: number
    visitId: string | null
  }
  http: {
    requestHeaders: Record<string, string>
    responseHeaders: Record<string, string>
    requestBody: DevtoolsBodyCapture
    responseBody: DevtoolsBodyCapture
  }
  props: Record<string, DevtoolsPropMeta>
  propValues: Record<string, unknown>
  route: { name: string | null; uri: string; action: string | null }
  renderSource: null
  componentPath: string | null
}

// ---------------------------------------------------------------------------
// Context variable exposed via c.var.inertia
// ---------------------------------------------------------------------------

export interface InertiaContext {
  render(
    component: string,
    props?: Record<string, unknown>,
    viewData?: Record<string, unknown>,
  ): Promise<Response>
  share(data: Record<string, unknown>): void
  location(url: string): Response
  redirect(url: string): Response
  encryptHistory(encrypt?: boolean): void
  clearHistory(clear?: boolean): void
  preserveFragment(preserve?: boolean): void
  viewData(data: Record<string, unknown>): void
  flash(data: Record<string, unknown>): void
}

// ---------------------------------------------------------------------------
// Hono Env type for typed c.var.inertia
// ---------------------------------------------------------------------------

export interface InertiaEnv {
  Variables: {
    inertia: InertiaContext
  }
}

// ---------------------------------------------------------------------------
// Scroll metadata adapter (public — users implement for their paginator)
// ---------------------------------------------------------------------------

export interface ScrollMetadata {
  getPageName(): string
  getCurrentPage(): number
  getPreviousPage(): number | null
  getNextPage(): number | null
}

// ---------------------------------------------------------------------------
// Tagged prop types (internal)
// ---------------------------------------------------------------------------

export type MergeStrategy = 'append' | 'prepend' | 'deep'

export interface OptionalProp {
  __hono_inertia_prop_type__: 'optional'
  value: () => unknown | Promise<unknown>
  isOnce: boolean
  onceKey: string | null
  expiresAt: number | null
}

export interface AlwaysProp {
  __hono_inertia_prop_type__: 'always'
  value: unknown
}

export interface DeferredProp {
  __hono_inertia_prop_type__: 'deferred'
  value: () => unknown | Promise<unknown>
  group: string
  shouldRescue: boolean
  isMerge: boolean
  mergeStrategy: MergeStrategy
  matchOn: string | null
  isOnce: boolean
  onceKey: string | null
  expiresAt: number | null
}

export interface MergeProp {
  __hono_inertia_prop_type__: 'merge'
  value: unknown | (() => unknown | Promise<unknown>)
  strategy: MergeStrategy
  matchOn: string | null
}

export interface OnceProp {
  __hono_inertia_prop_type__: 'once'
  value: () => unknown | Promise<unknown>
  onceKey: string | null
  expiresAt: number | null
}

export interface ScrollProp {
  __hono_inertia_prop_type__: 'scroll'
  value: unknown | (() => unknown | Promise<unknown>)
  pageName: string
  currentPage: number
  previousPage: number | null
  nextPage: number | null
  matchOn: string | null
}

export type TaggedProp =
  | OptionalProp
  | AlwaysProp
  | DeferredProp
  | MergeProp
  | OnceProp
  | ScrollProp
