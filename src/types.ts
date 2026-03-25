import type { Context } from 'hono'

// ---------------------------------------------------------------------------
// Page object (sent to the Inertia client)
// ---------------------------------------------------------------------------

export interface PageObject {
  component: string
  props: Record<string, unknown>
  url: string
  version: string
  encryptHistory?: boolean
  clearHistory?: boolean
  preserveFragment?: boolean
  sharedProps?: string[]
  deferredProps?: Record<string, string[]>
  mergeProps?: string[]
  prependProps?: string[]
  deepMergeProps?: string[]
  matchPropsOn?: string[]
  onceProps?: Record<string, { prop: string; expiresAt: number | null }>
  scrollProps?: Record<string, {
    pageName: string
    previousPage: number | null
    nextPage: number | null
    currentPage: number
  }>
}

// ---------------------------------------------------------------------------
// SSR
// ---------------------------------------------------------------------------

export interface SsrConfig {
  url?: string
  enabled?: boolean
}

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
  ssr?: SsrResult,
) => string | Promise<string>

// ---------------------------------------------------------------------------
// Middleware configuration
// ---------------------------------------------------------------------------

export interface InertiaConfig {
  version?: string | (() => string | Promise<string>)
  render: RenderFunction
  ssr?: SsrConfig
  share?: (c: Context) => Record<string, unknown> | Promise<Record<string, unknown>>
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
}

export type TaggedProp =
  | OptionalProp
  | AlwaysProp
  | DeferredProp
  | MergeProp
  | OnceProp
  | ScrollProp
