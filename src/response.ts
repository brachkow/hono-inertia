import type { Context } from 'hono'
import type {
  AlwaysProp,
  DeferredProp,
  InertiaConfig,
  InertiaContext,
  MergeProp,
  MergeStrategy,
  OnceProp,
  OptionalProp,
  PageObject,
  ScrollProp,
  SsrResult,
  TaggedProp,
} from './types.js'
import { isTaggedProp } from './props.js'
import { dispatchToSsr } from './ssr.js'
import {
  cacheControlValue,
  getErrorBag,
  getExceptOnceProps,
  getPartialComponent,
  getPartialData,
  getPartialExcept,
  getResetProps,
  getScrollMergeIntent,
  hasScrollMergeIntent,
  isInertiaRequest,
  resolveUrl,
} from './utils.js'

export class InertiaResponse implements InertiaContext {
  private sharedProps: Record<string, unknown> = {}
  private viewDataStore: Record<string, unknown> = {}
  private flashStore: Record<string, unknown> = {}
  private shouldEncryptHistory = false
  private shouldClearHistory = false
  private shouldPreserveFragment = false

  constructor(
    private c: Context,
    private config: InertiaConfig,
    private version: () => Promise<string | null>,
  ) {}

  share(data: Record<string, unknown>): void {
    Object.assign(this.sharedProps, data)
  }

  viewData(data: Record<string, unknown>): void {
    Object.assign(this.viewDataStore, data)
  }

  flash(data: Record<string, unknown>): void {
    Object.assign(this.flashStore, data)
  }

  encryptHistory(encrypt = true): void {
    this.shouldEncryptHistory = encrypt
  }

  clearHistory(clear = true): void {
    this.shouldClearHistory = clear
  }

  preserveFragment(preserve = true): void {
    this.shouldPreserveFragment = preserve
  }

  redirect(url: string): Response {
    if (isInertiaRequest(this.c)) {
      return new Response(null, {
        status: 409,
        headers: {
          'X-Inertia-Redirect': url,
          'Vary': 'X-Inertia',
          ...this.cacheControlHeader(),
        },
      })
    }
    return this.c.redirect(url, 302)
  }

  location(url: string): Response {
    if (isInertiaRequest(this.c)) {
      return new Response(null, {
        status: 409,
        headers: {
          'X-Inertia-Location': url,
          'Vary': 'X-Inertia',
          ...this.cacheControlHeader(),
        },
      })
    }
    return this.c.redirect(url, 302)
  }

  private cacheControlHeader(): Record<string, string> {
    const cacheControl = cacheControlValue(this.config)
    return cacheControl !== undefined ? { 'Cache-Control': cacheControl } : {}
  }

  async render(
    component: string,
    props: Record<string, unknown> = {},
    extraViewData: Record<string, unknown> = {},
  ): Promise<Response> {
    const mergedViewData = { ...this.viewDataStore, ...extraViewData }

    // 1. Capture shared prop keys before merging (for v3 instant visits)
    const sharedKeys = Object.keys(this.sharedProps)

    // 2. Merge shared + render props. Render props win. Ensure errors exists.
    const allProps: Record<string, unknown> = {
      errors: {},
      ...this.sharedProps,
      ...props,
    }

    const isInertia = isInertiaRequest(this.c)
    const partialComponent = getPartialComponent(this.c)
    const isPartialForThis = partialComponent === component
    const partialData = getPartialData(this.c)
    const partialExcept = getPartialExcept(this.c)
    const isPartialRequest =
      isPartialForThis && (partialData.size > 0 || partialExcept.size > 0)
    const exceptOnceProps = getExceptOnceProps(this.c)
    const errorBag = getErrorBag(this.c)
    const resetProps = getResetProps(this.c)
    const scrollMergeIntent = getScrollMergeIntent(this.c)
    // No merge-intent header => a fresh load, so the client should reset the
    // accumulated infinite-scroll collection rather than append/prepend.
    const scrollReset = !hasScrollMergeIntent(this.c)

    // 3. Classify props and determine which to include
    const included: Record<string, unknown> = {}
    const deferredGroups: Record<string, string[]> = {}
    const mergeKeys: string[] = []
    const prependKeys: string[] = []
    const deepMergeKeys: string[] = []
    const matchOnKeys: string[] = []
    const onceMetadata: Record<
      string,
      { prop: string; expiresAt: number | null }
    > = {}
    const scrollMetadata: Record<
      string,
      { pageName: string; previousPage: number | null; nextPage: number | null; currentPage: number; reset: boolean }
    > = {}

    // A top-level prop is requested if named directly or via a nested path
    // (e.g. `only: ['user.name']` requests the `user` prop). The client extracts
    // the nested slice; the server only resolves whole top-level props.
    const isRequestedByPartialData = (key: string): boolean => {
      if (partialData.has(key)) return true
      for (const entry of partialData) {
        if (entry.startsWith(`${key}.`)) return true
      }
      return false
    }

    const isFilteredOut = (key: string): boolean => {
      if (!isPartialRequest) return false
      if (key === 'errors') return false
      if (partialData.size > 0 && !isRequestedByPartialData(key)) return true
      if (partialExcept.size > 0 && partialExcept.has(key)) return true
      return false
    }

    const propHandlers: Record<string, (key: string, tagged: TaggedProp) => void> = {
      always: (key, tagged) => {
        included[key] = (tagged as AlwaysProp).value
      },

      optional: (key, tagged) => {
        const opt = tagged as OptionalProp
        if (isPartialRequest && isRequestedByPartialData(key)) {
          if (opt.isOnce && exceptOnceProps.has(opt.onceKey ?? key)) return
          included[key] = opt.value
          if (opt.isOnce) {
            onceMetadata[opt.onceKey ?? key] = {
              prop: key,
              expiresAt: opt.expiresAt,
            }
          }
        }
      },

      deferred: (key, tagged) => {
        const def = tagged as DeferredProp
        if (isPartialForThis && isRequestedByPartialData(key)) {
          if (def.isOnce && exceptOnceProps.has(def.onceKey ?? key)) return
          included[key] = def.value
          if (def.isMerge && !resetProps.has(key)) {
            collectMergeMetadata(key, def.mergeStrategy, def.matchOn, mergeKeys, prependKeys, deepMergeKeys, matchOnKeys)
          }
          if (def.isOnce) {
            onceMetadata[def.onceKey ?? key] = {
              prop: key,
              expiresAt: def.expiresAt,
            }
          }
        } else if (!isPartialRequest) {
          if (!deferredGroups[def.group]) {
            deferredGroups[def.group] = []
          }
          deferredGroups[def.group].push(key)
          if (def.isMerge) {
            collectMergeMetadata(key, def.mergeStrategy, def.matchOn, mergeKeys, prependKeys, deepMergeKeys, matchOnKeys)
          }
        }
      },

      merge: (key, tagged) => {
        const m = tagged as MergeProp
        if (isFilteredOut(key)) return
        included[key] = m.value
        if (!resetProps.has(key)) {
          collectMergeMetadata(key, m.strategy, m.matchOn, mergeKeys, prependKeys, deepMergeKeys, matchOnKeys)
        }
      },

      once: (key, tagged) => {
        const o = tagged as OnceProp
        if (exceptOnceProps.has(o.onceKey ?? key)) return
        if (isFilteredOut(key)) return
        included[key] = o.value
        onceMetadata[o.onceKey ?? key] = {
          prop: key,
          expiresAt: o.expiresAt,
        }
      },

      scroll: (key, tagged) => {
        const s = tagged as ScrollProp
        if (isFilteredOut(key)) return
        included[key] = s.value
        scrollMetadata[key] = {
          pageName: s.pageName,
          currentPage: s.currentPage,
          previousPage: s.previousPage,
          nextPage: s.nextPage,
          reset: scrollReset,
        }
        if (!resetProps.has(key)) {
          if (scrollMergeIntent === 'prepend') {
            prependKeys.push(key)
          } else {
            mergeKeys.push(key)
          }
        }
      },
    }

    for (const [key, value] of Object.entries(allProps)) {
      if (!isTaggedProp(value)) {
        if (!isFilteredOut(key)) {
          included[key] = value
        }
        continue
      }

      const propType = (value as TaggedProp).__hono_inertia_prop_type__
      propHandlers[propType]?.(key, value as TaggedProp)
    }

    // 4. Resolve lazy values (functions and async functions)
    const resolved: Record<string, unknown> = {}
    const resolvePromises: Promise<void>[] = []

    for (const [key, value] of Object.entries(included)) {
      if (typeof value === 'function') {
        const promise = Promise.resolve(value()).then((result) => {
          resolved[key] = result
        })
        resolvePromises.push(promise)
      } else {
        resolved[key] = value
      }
    }

    await Promise.all(resolvePromises)

    // 5. Handle error bag scoping
    if (errorBag && resolved.errors && typeof resolved.errors === 'object') {
      const errors = resolved.errors as Record<string, unknown>
      resolved.errors = errors[errorBag] ?? {}
    }

    // 6. Build page object
    const page: PageObject = {
      component,
      props: resolved,
      url: resolveUrl(this.c),
      version: await this.version(),
    }

    if (this.shouldEncryptHistory) {
      page.encryptHistory = true
    }
    if (this.shouldClearHistory) {
      page.clearHistory = true
    }
    if (this.shouldPreserveFragment) {
      page.preserveFragment = true
    }
    if (sharedKeys.length > 0) {
      page.sharedProps = sharedKeys
    }
    if (Object.keys(this.flashStore).length > 0) {
      page.flash = this.flashStore
    }
    if (Object.keys(deferredGroups).length > 0) {
      page.deferredProps = deferredGroups
    }
    if (mergeKeys.length > 0) {
      page.mergeProps = mergeKeys
    }
    if (prependKeys.length > 0) {
      page.prependProps = prependKeys
    }
    if (deepMergeKeys.length > 0) {
      page.deepMergeProps = deepMergeKeys
    }
    if (matchOnKeys.length > 0) {
      page.matchPropsOn = matchOnKeys
    }
    if (Object.keys(onceMetadata).length > 0) {
      page.onceProps = onceMetadata
    }
    if (Object.keys(scrollMetadata).length > 0) {
      page.scrollProps = scrollMetadata
    }

    // 7. Return response
    if (isInertia) {
      return new Response(JSON.stringify(page), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Inertia': 'true',
          'Vary': 'X-Inertia',
          ...this.cacheControlHeader(),
        },
      })
    }

    // Initial visit: optionally SSR, then render HTML
    let ssrResult: SsrResult | undefined
    if (this.config.ssr?.enabled !== false && this.config.ssr?.url) {
      const result = await dispatchToSsr(this.config.ssr, page)
      if (result) {
        ssrResult = result
      }
    }

    const htmlContent = await this.config.render(page, mergedViewData, ssrResult)
    const res = await this.c.html(htmlContent)
    // Only when absent: a Cache-Control set by the handler (via c.header) wins.
    const cacheControl = cacheControlValue(this.config)
    if (cacheControl !== undefined && !res.headers.has('Cache-Control')) {
      res.headers.set('Cache-Control', cacheControl)
    }
    return res
  }
}

function collectMergeMetadata(
  key: string,
  strategy: MergeStrategy,
  matchOn: string | null,
  mergeKeys: string[],
  prependKeys: string[],
  deepMergeKeys: string[],
  matchOnKeys: string[],
): void {
  const strategyCollectors: Record<MergeStrategy, () => void> = {
    append: () => mergeKeys.push(key),
    prepend: () => prependKeys.push(key),
    deep: () => deepMergeKeys.push(key),
  }
  strategyCollectors[strategy]()
  if (matchOn) {
    matchOnKeys.push(`${key}.${matchOn}`)
  }
}
