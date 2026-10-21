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

// A prop value, or a function that returns it, called only when the prop is sent
type Lazy<T> = T | (() => T | Promise<T>);

// The value a Lazy<T> argument stands for
type Resolved<V> = V extends () => infer R ? Awaited<R> : V;

export type OptionalChain<T = unknown> = OptionalProperty<T> & {
  once(key?: string, expiresAt?: number | null): OptionalProperty<T>;
};

export type DeferredChain<T = unknown> = DeferredProperty<T> & {
  rescue(): DeferredChain<T>;
  merge(): DeferredChain<T>;
  prepend(): DeferredChain<T>;
  deepMerge(): DeferredChain<T>;
  setMatchOn(field: string): DeferredChain<T>;
  once(key?: string, expiresAt?: number | null): DeferredChain<T>;
};

export type MergeChain<T = unknown> = MergeProperty<T> & {
  prepend(): MergeChain<T>;
  deepMerge(): MergeChain<T>;
  setMatchOn(field: string): MergeChain<T>;
};

export type ScrollChain<T = unknown> = ScrollProperty<T> & {
  setMatchOn(field: string): ScrollChain<T>;
};

// ---------------------------------------------------------------------------
// optional(fn) — excluded from first visit, included on partial reload
// ---------------------------------------------------------------------------

export function optional<T>(function_: () => T | Promise<T>): OptionalChain<T> {
  const property: OptionalProperty<T> = {
    [PROP_TYPE]: 'optional',
    value: function_,
    isOnce: false,
    onceKey: null,
    expiresAt: null,
  };

  return Object.assign(property, {
    once(key?: string, expiresAt?: number | null): OptionalProperty<T> {
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

export function always<V>(value: V): AlwaysProperty<Resolved<V>> {
  return { [PROP_TYPE]: 'always', value: value as Lazy<Resolved<V>> };
}

// ---------------------------------------------------------------------------
// deferred(fn, group?) — excluded from initial, fetched after mount
// ---------------------------------------------------------------------------

export function deferred<T>(
  function_: () => T | Promise<T>,
  group = 'default',
): DeferredChain<T> {
  const property: DeferredProperty<T> = {
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
    rescue(): DeferredChain<T> {
      property.shouldRescue = true;
      return result;
    },
    merge(): DeferredChain<T> {
      property.isMerge = true;
      property.mergeStrategy = 'append';
      return result;
    },
    prepend(): DeferredChain<T> {
      property.isMerge = true;
      property.mergeStrategy = 'prepend';
      return result;
    },
    deepMerge(): DeferredChain<T> {
      property.isMerge = true;
      property.mergeStrategy = 'deep';
      return result;
    },
    setMatchOn(field: string): DeferredChain<T> {
      property.matchOn = field;
      return result;
    },
    once(key?: string, expiresAt?: number | null): DeferredChain<T> {
      property.isOnce = true;
      property.onceKey = key ?? null;
      property.expiresAt = expiresAt ?? null;
      return result;
    },
  };

  const result: DeferredChain<T> = Object.assign(property, chain);
  return result;
}

// ---------------------------------------------------------------------------
// merge(value) — client appends new data instead of replacing
// ---------------------------------------------------------------------------

export function merge<V>(value: V): MergeChain<Resolved<V>> {
  type T = Resolved<V>;
  const property: MergeProperty<T> = {
    [PROP_TYPE]: 'merge',
    value: value as Lazy<T>,
    strategy: 'append',
    matchOn: null,
  };

  const chain = {
    prepend(): MergeChain<T> {
      property.strategy = 'prepend';
      return result;
    },
    deepMerge(): MergeChain<T> {
      property.strategy = 'deep';
      return result;
    },
    setMatchOn(field: string): MergeChain<T> {
      property.matchOn = field;
      return result;
    },
  };

  const result: MergeChain<T> = Object.assign(property, chain);
  return result;
}

// ---------------------------------------------------------------------------
// prepend(value) — sugar for merge().prepend()
// ---------------------------------------------------------------------------

export function prepend<V>(value: V): MergeChain<Resolved<V>> {
  return merge(value).prepend();
}

// ---------------------------------------------------------------------------
// deepMerge(value) — sugar for merge().deepMerge()
// ---------------------------------------------------------------------------

export function deepMerge<V>(value: V): MergeChain<Resolved<V>> {
  return merge(value).deepMerge();
}

// ---------------------------------------------------------------------------
// once(fn) — resolved once, client caches across navigations
// ---------------------------------------------------------------------------

export function once<T>(
  function_: () => T | Promise<T>,
  key?: string,
  expiresAt?: number | null,
): OnceProperty<T> {
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

export function scroll<V>(
  value: V,
  metadata: ScrollMetadata,
): ScrollChain<Resolved<V>> {
  type T = Resolved<V>;
  const property: ScrollProperty<T> = {
    [PROP_TYPE]: 'scroll',
    value: value as Lazy<T>,
    pageName: metadata.getPageName(),
    currentPage: metadata.getCurrentPage(),
    previousPage: metadata.getPreviousPage(),
    nextPage: metadata.getNextPage(),
    matchOn: null,
  };

  const chain = {
    setMatchOn(field: string): ScrollChain<T> {
      property.matchOn = field;
      return result;
    },
  };

  const result: ScrollChain<T> = Object.assign(property, chain);
  return result;
}
