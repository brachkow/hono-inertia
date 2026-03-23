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
  SsrResult,
  TaggedProp,
} from './types.js'
import { isTaggedProp } from './props.js'
import { dispatchToSsr } from './ssr.js'
import {
  getErrorBag,
  getExceptOnceProps,
  getPartialComponent,
  getPartialData,
  getPartialExcept,
  getResetProps,
  isInertiaRequest,
  resolveUrl,
} from './utils.js'

export class InertiaResponse implements InertiaContext {
  private sharedProps: Record<string, unknown> = {}
  private viewDataStore: Record<string, unknown> = {}
  private shouldEncryptHistory = false
  private shouldClearHistory = false

  constructor(
    private c: Context,
    private config: InertiaConfig,
    private version: string,
  ) {}

  share(data: Record<string, unknown>): void {
    Object.assign(this.sharedProps, data)
  }

  viewData(data: Record<string, unknown>): void {
    Object.assign(this.viewDataStore, data)
  }

  encryptHistory(encrypt = true): void {
    this.shouldEncryptHistory = encrypt
  }

  clearHistory(clear = true): void {
    this.shouldClearHistory = clear
  }

  location(url: string): Response {
    if (isInertiaRequest(this.c)) {
      return new Response(null, {
        status: 409,
        headers: {
          'X-Inertia-Location': url,
          'Vary': 'X-Inertia',
        },
      })
    }
    return this.c.redirect(url, 302)
  }

  async render(
    component: string,
    props: Record<string, unknown> = {},
    extraViewData: Record<string, unknown> = {},
  ): Promise<Response> {
    const mergedViewData = { ...this.viewDataStore, ...extraViewData }

    // 1. Merge shared + render props. Render props win. Ensure errors exists.
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
      isPartialForThis && (partialData.length > 0 || partialExcept.length > 0)
    const exceptOnceProps = getExceptOnceProps(this.c)
    const errorBag = getErrorBag(this.c)
    const resetProps = getResetProps(this.c)

    // 2. Classify props and determine which to include
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

    for (const [key, value] of Object.entries(allProps)) {
      if (!isTaggedProp(value)) {
        // Plain value or lazy function
        if (isPartialRequest) {
          if (partialData.length > 0 && !partialData.includes(key) && key !== 'errors') {
            continue
          }
          if (partialExcept.length > 0 && partialExcept.includes(key) && key !== 'errors') {
            continue
          }
        }
        included[key] = value
        continue
      }

      const propType = (value as TaggedProp).__hono_inertia_prop_type__

      switch (propType) {
        case 'always': {
          // Always included regardless of partial filters
          included[key] = (value as AlwaysProp).value
          break
        }

        case 'optional': {
          const opt = value as OptionalProp
          // Only included when explicitly requested in a partial reload
          if (isPartialRequest && partialData.includes(key)) {
            if (opt.isOnce && exceptOnceProps.includes(key)) {
              // Client already has this once-prop, skip
              continue
            }
            included[key] = opt.value
            if (opt.isOnce) {
              onceMetadata[key] = {
                prop: opt.onceKey ?? key,
                expiresAt: opt.expiresAt,
              }
            }
          }
          // Excluded on full visits and non-matching partial reloads
          break
        }

        case 'deferred': {
          const def = value as DeferredProp
          if (isPartialForThis && partialData.includes(key)) {
            // This is the follow-up request to fetch the deferred prop
            if (def.isOnce && exceptOnceProps.includes(key)) {
              continue
            }
            included[key] = def.value
            if (def.isMerge && !resetProps.includes(key)) {
              collectMergeMetadata(
                key,
                def.mergeStrategy,
                def.matchOn,
                mergeKeys,
                prependKeys,
                deepMergeKeys,
                matchOnKeys,
              )
            }
            if (def.isOnce) {
              onceMetadata[key] = {
                prop: def.onceKey ?? key,
                expiresAt: def.expiresAt,
              }
            }
          } else if (!isPartialRequest) {
            // Full visit: register in deferredProps groups, don't include value
            if (!deferredGroups[def.group]) {
              deferredGroups[def.group] = []
            }
            deferredGroups[def.group].push(key)
            // Still add merge metadata so client knows how to handle deferred data
            if (def.isMerge) {
              collectMergeMetadata(
                key,
                def.mergeStrategy,
                def.matchOn,
                mergeKeys,
                prependKeys,
                deepMergeKeys,
                matchOnKeys,
              )
            }
          }
          break
        }

        case 'merge': {
          const m = value as MergeProp
          if (isPartialRequest) {
            if (partialData.length > 0 && !partialData.includes(key) && key !== 'errors') {
              continue
            }
            if (partialExcept.length > 0 && partialExcept.includes(key) && key !== 'errors') {
              continue
            }
          }
          included[key] = m.value
          if (!resetProps.includes(key)) {
            collectMergeMetadata(
              key,
              m.strategy,
              m.matchOn,
              mergeKeys,
              prependKeys,
              deepMergeKeys,
              matchOnKeys,
            )
          }
          break
        }

        case 'once': {
          const o = value as OnceProp
          if (exceptOnceProps.includes(key)) {
            // Client already has this, skip resolving
            continue
          }
          if (isPartialRequest) {
            if (partialData.length > 0 && !partialData.includes(key) && key !== 'errors') {
              continue
            }
            if (partialExcept.length > 0 && partialExcept.includes(key) && key !== 'errors') {
              continue
            }
          }
          included[key] = o.value
          onceMetadata[key] = {
            prop: o.onceKey ?? key,
            expiresAt: o.expiresAt,
          }
          break
        }
      }
    }

    // 3. Resolve lazy values (functions and async functions)
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

    // 4. Handle error bag scoping
    if (errorBag && resolved.errors && typeof resolved.errors === 'object') {
      const errors = resolved.errors as Record<string, unknown>
      resolved.errors = errors[errorBag] ?? {}
    }

    // 5. Build page object
    const page: PageObject = {
      component,
      props: resolved,
      url: resolveUrl(this.c),
      version: this.version,
      encryptHistory: this.shouldEncryptHistory,
      clearHistory: this.shouldClearHistory,
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

    // 6. Return response
    if (isInertia) {
      return new Response(JSON.stringify(page), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Inertia': 'true',
          'Vary': 'X-Inertia',
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
    return this.c.html(htmlContent)
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
  switch (strategy) {
    case 'append':
      mergeKeys.push(key)
      break
    case 'prepend':
      prependKeys.push(key)
      break
    case 'deep':
      deepMergeKeys.push(key)
      break
  }
  if (matchOn) {
    matchOnKeys.push(`${key}.${matchOn}`)
  }
}
