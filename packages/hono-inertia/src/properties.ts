import { PROP_TYPE } from './symbols.js';
import type {
  AlwaysProperty,
  DeferredProperty,
  LiveChannel,
  LiveOptions,
  LivePropertyMetadata,
  LiveProperty,
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

// Laravel's adapter refuses this combination, and the Inertia docs say merge
// props cannot be live.
const MERGE_LIVE_ERROR = 'A merge prop cannot be live';

// A prop value, or a function that returns it, called only when the prop is sent
type Lazy<T> = T | (() => T | Promise<T>);

// The value a Lazy<T> argument stands for
type Resolved<V> = V extends () => infer R ? Awaited<R> : V;

export type OptionalChain<T = unknown> = OptionalProperty<T> & {
  once(key?: string, expiresAt?: number | null): OptionalChain<T>;
  live(options: LiveOptions): OptionalChain<T>;
};

export type AlwaysChain<T = unknown> = AlwaysProperty<T> & {
  live(options: LiveOptions): AlwaysChain<T>;
};

export type OnceChain<T = unknown> = OnceProperty<T> & {
  live(options: LiveOptions): OnceChain<T>;
};

export type LiveChain<T = unknown> = LiveProperty<T> & {
  live(options: LiveOptions): LiveChain<T>;
};

export type DeferredChain<T = unknown> = DeferredProperty<T> & {
  rescue(): DeferredChain<T>;
  live(options: LiveOptions): DeferredChain<T>;
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

  const chain = {
    once(key?: string, expiresAt?: number | null): OptionalChain<T> {
      property.isOnce = true;
      property.onceKey = key ?? null;
      property.expiresAt = expiresAt ?? null;
      return result;
    },
    live(options: LiveOptions): OptionalChain<T> {
      property.liveMetadata = addLiveListeners(property.liveMetadata, options);
      return result;
    },
  };

  const result: OptionalChain<T> = Object.assign(property, chain);
  return result;
}

// ---------------------------------------------------------------------------
// always(value) — always included, even in partial reloads
// ---------------------------------------------------------------------------

export function always<V>(value: V): AlwaysChain<Resolved<V>> {
  type T = Resolved<V>;
  const property: AlwaysProperty<T> = {
    [PROP_TYPE]: 'always',
    value: value as Lazy<T>,
  };

  const chain = {
    live(options: LiveOptions): AlwaysChain<T> {
      property.liveMetadata = addLiveListeners(property.liveMetadata, options);
      return result;
    },
  };

  const result: AlwaysChain<T> = Object.assign(property, chain);
  return result;
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
    live(options: LiveOptions): DeferredChain<T> {
      if (property.isMerge) throw new Error(MERGE_LIVE_ERROR);
      property.liveMetadata = addLiveListeners(property.liveMetadata, options);
      return result;
    },
    merge(): DeferredChain<T> {
      if (property.liveMetadata) throw new Error(MERGE_LIVE_ERROR);
      property.isMerge = true;
      property.mergeStrategy = 'append';
      return result;
    },
    prepend(): DeferredChain<T> {
      if (property.liveMetadata) throw new Error(MERGE_LIVE_ERROR);
      property.isMerge = true;
      property.mergeStrategy = 'prepend';
      return result;
    },
    deepMerge(): DeferredChain<T> {
      if (property.liveMetadata) throw new Error(MERGE_LIVE_ERROR);
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
): OnceChain<T> {
  const property: OnceProperty<T> = {
    [PROP_TYPE]: 'once',
    value: function_,
    onceKey: key ?? null,
    expiresAt: expiresAt ?? null,
  };

  const chain = {
    live(options: LiveOptions): OnceChain<T> {
      property.liveMetadata = addLiveListeners(property.liveMetadata, options);
      return result;
    },
  };

  const result: OnceChain<T> = Object.assign(property, chain);
  return result;
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

// ---------------------------------------------------------------------------
// live(value, options) — refreshed when a broadcast event arrives
// ---------------------------------------------------------------------------

export function live<V>(
  value: V,
  options: LiveOptions,
): LiveChain<Resolved<V>> {
  type T = Resolved<V>;
  const property: LiveProperty<T> = {
    [PROP_TYPE]: 'live',
    value: value as Lazy<T>,
    liveMetadata: addLiveListeners(undefined, options),
  };

  const chain = {
    live(more: LiveOptions): LiveChain<T> {
      property.liveMetadata = addLiveListeners(property.liveMetadata, more);
      return result;
    },
  };

  const result: LiveChain<T> = Object.assign(property, chain);
  return result;
}

// Wraps values for a broadcast event payload, so listening pages write them
// directly instead of each making a partial reload. Every subscriber gets the
// same payload, so send only what all of them may see.
export function broadcastProperties(properties: Record<string, unknown>): {
  __inertia: { props: Record<string, unknown> };
} {
  return { __inertia: { props: properties } };
}

const toChannel = (channel: string | LiveChannel): LiveChannel =>
  typeof channel === 'string' ? { name: channel, type: 'public' } : channel;

// Each .live() call pairs its channels with its own events, so the client
// does not subscribe to every channel for every event. Events for a channel
// that is already listed join its listener.
function addLiveListeners(
  current: LivePropertyMetadata | undefined,
  options: LiveOptions,
): LivePropertyMetadata {
  const channels = (
    Array.isArray(options.channel) ? options.channel : [options.channel]
  ).map(toChannel);
  const events = Array.isArray(options.on) ? options.on : [options.on];
  if (channels.length === 0 || events.length === 0) {
    throw new Error('A live prop needs at least one channel and one event');
  }

  const listeners = (current?.listeners ?? []).map((listener) => ({
    channel: listener.channel,
    events: [...listener.events],
  }));
  for (const channel of channels) {
    const existing = listeners.find(
      (listener) =>
        listener.channel.type === channel.type &&
        listener.channel.name === channel.name,
    );
    if (existing) {
      for (const event of events) {
        if (!existing.events.includes(event)) existing.events.push(event);
      }
    } else {
      listeners.push({ channel, events: [...events] });
    }
  }

  const throttle = options.throttle ?? current?.throttle;
  return throttle === undefined ? { listeners } : { listeners, throttle };
}
