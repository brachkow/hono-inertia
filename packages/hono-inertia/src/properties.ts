import { PROP_TYPE } from './symbols.js';
import type {
  AlwaysProperty,
  DeferredProperty,
  MergeProperty,
  OnceProperty,
  OptionalProperty,
  ScrollMetadata,
  ScrollProperty,
  TaggedProperty,
} from './types.js';

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

export function isTaggedProp(value: unknown): value is TaggedProperty {
  return (
    value !== null &&
    typeof value === 'object' &&
    PROP_TYPE in (value as Record<string, unknown>)
  );
}

// ---------------------------------------------------------------------------
// Chainable return types
// ---------------------------------------------------------------------------

export type OptionalChain = OptionalProperty & {
  once(key?: string, expiresAt?: number | null): OptionalProperty;
};

export type DeferredChain = DeferredProperty & {
  rescue(): DeferredChain;
  merge(): DeferredChain;
  prepend(): DeferredChain;
  deepMerge(): DeferredChain;
  setMatchOn(field: string): DeferredChain;
  once(key?: string, expiresAt?: number | null): DeferredChain;
};

export type MergeChain = MergeProperty & {
  prepend(): MergeChain;
  deepMerge(): MergeChain;
  setMatchOn(field: string): MergeChain;
};

export type ScrollChain = ScrollProperty & {
  setMatchOn(field: string): ScrollChain;
};

// ---------------------------------------------------------------------------
// optional(fn) — excluded from first visit, included on partial reload
// ---------------------------------------------------------------------------

export function optional(
  function_: () => unknown | Promise<unknown>,
): OptionalChain {
  const property: OptionalProperty = {
    [PROP_TYPE]: 'optional',
    value: function_,
    isOnce: false,
    onceKey: null,
    expiresAt: null,
  };

  return Object.assign(property, {
    once(key?: string, expiresAt?: number | null): OptionalProperty {
      property.isOnce = true;
      property.onceKey = key ?? null;
      property.expiresAt = expiresAt ?? null;
      return property;
    },
  });
}

// ---------------------------------------------------------------------------
// always(value) — always included, even in partial reloads
// ---------------------------------------------------------------------------

export function always(value: unknown): AlwaysProperty {
  return { [PROP_TYPE]: 'always', value };
}

// ---------------------------------------------------------------------------
// deferred(fn, group?) — excluded from initial, fetched after mount
// ---------------------------------------------------------------------------

export function deferred(
  function_: () => unknown | Promise<unknown>,
  group = 'default',
): DeferredChain {
  const property: DeferredProperty = {
    [PROP_TYPE]: 'deferred',
    value: function_,
    group,
    shouldRescue: false,
    isMerge: false,
    mergeStrategy: 'append',
    matchOn: null,
    isOnce: false,
    onceKey: null,
    expiresAt: null,
  };

  const chain = {
    rescue(): DeferredChain {
      property.shouldRescue = true;
      return result;
    },
    merge(): DeferredChain {
      property.isMerge = true;
      property.mergeStrategy = 'append';
      return result;
    },
    prepend(): DeferredChain {
      property.isMerge = true;
      property.mergeStrategy = 'prepend';
      return result;
    },
    deepMerge(): DeferredChain {
      property.isMerge = true;
      property.mergeStrategy = 'deep';
      return result;
    },
    setMatchOn(field: string): DeferredChain {
      property.matchOn = field;
      return result;
    },
    once(key?: string, expiresAt?: number | null): DeferredChain {
      property.isOnce = true;
      property.onceKey = key ?? null;
      property.expiresAt = expiresAt ?? null;
      return result;
    },
  };

  const result: DeferredChain = Object.assign(property, chain);
  return result;
}

// ---------------------------------------------------------------------------
// merge(value) — client appends new data instead of replacing
// ---------------------------------------------------------------------------

export function merge(
  value: unknown | (() => unknown | Promise<unknown>),
): MergeChain {
  const property: MergeProperty = {
    [PROP_TYPE]: 'merge',
    value,
    strategy: 'append',
    matchOn: null,
  };

  const chain = {
    prepend(): MergeChain {
      property.strategy = 'prepend';
      return result;
    },
    deepMerge(): MergeChain {
      property.strategy = 'deep';
      return result;
    },
    setMatchOn(field: string): MergeChain {
      property.matchOn = field;
      return result;
    },
  };

  const result: MergeChain = Object.assign(property, chain);
  return result;
}

// ---------------------------------------------------------------------------
// prepend(value) — sugar for merge().prepend()
// ---------------------------------------------------------------------------

export function prepend(
  value: unknown | (() => unknown | Promise<unknown>),
): MergeChain {
  return merge(value).prepend();
}

// ---------------------------------------------------------------------------
// deepMerge(value) — sugar for merge().deepMerge()
// ---------------------------------------------------------------------------

export function deepMerge(
  value: unknown | (() => unknown | Promise<unknown>),
): MergeChain {
  return merge(value).deepMerge();
}

// ---------------------------------------------------------------------------
// once(fn) — resolved once, client caches across navigations
// ---------------------------------------------------------------------------

export function once(
  function_: () => unknown | Promise<unknown>,
  key?: string,
  expiresAt?: number | null,
): OnceProperty {
  return {
    [PROP_TYPE]: 'once',
    value: function_,
    onceKey: key ?? null,
    expiresAt: expiresAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// scroll(value, metadata) — infinite scroll with pagination metadata
// ---------------------------------------------------------------------------

export function scroll(
  value: unknown | (() => unknown | Promise<unknown>),
  metadata: ScrollMetadata,
): ScrollChain {
  const property: ScrollProperty = {
    [PROP_TYPE]: 'scroll',
    value,
    pageName: metadata.getPageName(),
    currentPage: metadata.getCurrentPage(),
    previousPage: metadata.getPreviousPage(),
    nextPage: metadata.getNextPage(),
    matchOn: null,
  };

  const chain = {
    setMatchOn(field: string): ScrollChain {
      property.matchOn = field;
      return result;
    },
  };

  const result: ScrollChain = Object.assign(property, chain);
  return result;
}
