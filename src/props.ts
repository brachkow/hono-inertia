import { PROP_TYPE } from './symbols.js'
import type {
  AlwaysProp,
  DeferredProp,
  MergeProp,
  MergeStrategy,
  OnceProp,
  OptionalProp,
  ScrollMetadata,
  ScrollProp,
  TaggedProp,
} from './types.js'

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

export function isTaggedProp(value: unknown): value is TaggedProp {
  return (
    value !== null &&
    typeof value === 'object' &&
    PROP_TYPE in (value as Record<string, unknown>)
  )
}

// ---------------------------------------------------------------------------
// Chainable return types
// ---------------------------------------------------------------------------

export type OptionalChain = OptionalProp & {
  once(key?: string, expiresAt?: number | null): OptionalProp
}

export type DeferredChain = DeferredProp & {
  merge(): DeferredChain
  prepend(): DeferredChain
  deepMerge(): DeferredChain
  setMatchOn(field: string): DeferredChain
  once(key?: string, expiresAt?: number | null): DeferredChain
}

export type MergeChain = MergeProp & {
  prepend(): MergeChain
  deepMerge(): MergeChain
  setMatchOn(field: string): MergeChain
}

// ---------------------------------------------------------------------------
// optional(fn) — excluded from first visit, included on partial reload
// ---------------------------------------------------------------------------

export function optional(
  fn: () => unknown | Promise<unknown>,
): OptionalChain {
  const prop: OptionalProp = {
    [PROP_TYPE]: 'optional',
    value: fn,
    isOnce: false,
    onceKey: null,
    expiresAt: null,
  }

  return Object.assign(prop, {
    once(key?: string, expiresAt?: number | null): OptionalProp {
      prop.isOnce = true
      prop.onceKey = key ?? null
      prop.expiresAt = expiresAt ?? null
      return prop
    },
  })
}

// ---------------------------------------------------------------------------
// always(value) — always included, even in partial reloads
// ---------------------------------------------------------------------------

export function always(value: unknown): AlwaysProp {
  return { [PROP_TYPE]: 'always', value }
}

// ---------------------------------------------------------------------------
// deferred(fn, group?) — excluded from initial, fetched after mount
// ---------------------------------------------------------------------------

export function deferred(
  fn: () => unknown | Promise<unknown>,
  group = 'default',
): DeferredChain {
  const prop: DeferredProp = {
    [PROP_TYPE]: 'deferred',
    value: fn,
    group,
    isMerge: false,
    mergeStrategy: 'append' as MergeStrategy,
    matchOn: null,
    isOnce: false,
    onceKey: null,
    expiresAt: null,
  }

  const chain = {
    merge(): DeferredChain {
      prop.isMerge = true
      prop.mergeStrategy = 'append'
      return result
    },
    prepend(): DeferredChain {
      prop.isMerge = true
      prop.mergeStrategy = 'prepend'
      return result
    },
    deepMerge(): DeferredChain {
      prop.isMerge = true
      prop.mergeStrategy = 'deep'
      return result
    },
    setMatchOn(field: string): DeferredChain {
      prop.matchOn = field
      return result
    },
    once(key?: string, expiresAt?: number | null): DeferredChain {
      prop.isOnce = true
      prop.onceKey = key ?? null
      prop.expiresAt = expiresAt ?? null
      return result
    },
  }

  const result: DeferredChain = Object.assign(prop, chain)
  return result
}

// ---------------------------------------------------------------------------
// merge(value) — client appends new data instead of replacing
// ---------------------------------------------------------------------------

export function merge(
  value: unknown | (() => unknown | Promise<unknown>),
): MergeChain {
  const prop: MergeProp = {
    [PROP_TYPE]: 'merge',
    value,
    strategy: 'append',
    matchOn: null,
  }

  const chain = {
    prepend(): MergeChain {
      prop.strategy = 'prepend'
      return result
    },
    deepMerge(): MergeChain {
      prop.strategy = 'deep'
      return result
    },
    setMatchOn(field: string): MergeChain {
      prop.matchOn = field
      return result
    },
  }

  const result: MergeChain = Object.assign(prop, chain)
  return result
}

// ---------------------------------------------------------------------------
// prepend(value) — sugar for merge().prepend()
// ---------------------------------------------------------------------------

export function prepend(
  value: unknown | (() => unknown | Promise<unknown>),
): MergeChain {
  return merge(value).prepend()
}

// ---------------------------------------------------------------------------
// deepMerge(value) — sugar for merge().deepMerge()
// ---------------------------------------------------------------------------

export function deepMerge(
  value: unknown | (() => unknown | Promise<unknown>),
): MergeChain {
  return merge(value).deepMerge()
}

// ---------------------------------------------------------------------------
// once(fn) — resolved once, client caches across navigations
// ---------------------------------------------------------------------------

export function once(
  fn: () => unknown | Promise<unknown>,
  key?: string,
  expiresAt?: number | null,
): OnceProp {
  return {
    [PROP_TYPE]: 'once',
    value: fn,
    onceKey: key ?? null,
    expiresAt: expiresAt ?? null,
  }
}

// ---------------------------------------------------------------------------
// scroll(value, metadata) — infinite scroll with pagination metadata
// ---------------------------------------------------------------------------

export function scroll(
  value: unknown | (() => unknown | Promise<unknown>),
  metadata: ScrollMetadata,
): ScrollProp {
  return {
    [PROP_TYPE]: 'scroll',
    value,
    pageName: metadata.getPageName(),
    currentPage: metadata.getCurrentPage(),
    previousPage: metadata.getPreviousPage(),
    nextPage: metadata.getNextPage(),
  }
}
