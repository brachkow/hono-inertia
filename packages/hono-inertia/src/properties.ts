import { PROP_TYPE } from './symbols.js';
import type {
  AlwaysProperty,
  Lazy,
  DeferredProperty,
  LiveChannel,
  LiveOptions,
  LivePropertyMetadata,
  LiveProperty,
  MergeProperty,
  MergeSettings,
  OnceOptions,
  OnceProperty,
  OnceSettings,
  OptionalProperty,
  ScrollOptions,
  ScrollPage,
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

// The value a Lazy<T> argument stands for
type Resolved<V> = V extends () => infer R ? Awaited<R> : V;

// The merge methods merge(), deferred().merge() and the like share. Without a
// path, append() and prepend() merge at the root of the prop; with one, at
// that path inside it, matched on matchOn when given.
interface MergeMethods<Chain> {
  append(path?: string, matchOn?: string): Chain;
  prepend(path?: string, matchOn?: string): Chain;
  deepMerge(): Chain;
  // A field, or fields, that identify an item, so the client replaces it
  // instead of adding it twice
  matchOn(fields: string | string[]): Chain;
}

export type OptionalChain<T = unknown> = OptionalProperty<T> & {
  once(options?: OnceOptions): OptionalChain<T>;
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

export type DeferredChain<T = unknown> = DeferredProperty<T> &
  MergeMethods<DeferredChain<T>> & {
    rescue(): DeferredChain<T>;
    live(options: LiveOptions): DeferredChain<T>;
    merge(): DeferredChain<T>;
    once(options?: OnceOptions): DeferredChain<T>;
  };

export type MergeChain<T = unknown> = MergeProperty<T> &
  MergeMethods<MergeChain<T>>;

export type ScrollChain<T = unknown> = ScrollProperty<T> & {
  matchOn(fields: string | string[]): ScrollChain<T>;
};

const toList = (fields: string | string[]): string[] =>
  Array.isArray(fields) ? fields : [fields];

const createMergeSettings = (): MergeSettings => ({
  strategy: 'append',
  appendPaths: [],
  prependPaths: [],
  matchOn: [],
});

// One append() or prepend() call, as Laravel's MergesProps applies it:
// without a path it sets the root strategy, with one it merges at the path
const updateMerge = (
  settings: MergeSettings,
  direction: 'append' | 'prepend',
  path?: string,
  matchOn?: string,
): void => {
  if (path === undefined) {
    settings.strategy = direction;
    return;
  }
  settings[direction === 'append' ? 'appendPaths' : 'prependPaths'].push(path);
  if (matchOn) settings.matchOn.push(`${path}.${matchOn}`);
};

const toOnceSettings = (options: OnceOptions = {}): OnceSettings => ({
  key: options.key ?? null,
  ttl: options.ttl ?? null,
});

// The chain methods several prop types share. `chain` returns the prop the
// methods are assigned to, so each method returns it for the next call.

const mergeMethods = <Chain>(
  settings: () => MergeSettings,
  chain: () => Chain,
): MergeMethods<Chain> => ({
  append(path?: string, matchOn?: string): Chain {
    updateMerge(settings(), 'append', path, matchOn);
    return chain();
  },
  prepend(path?: string, matchOn?: string): Chain {
    updateMerge(settings(), 'prepend', path, matchOn);
    return chain();
  },
  deepMerge(): Chain {
    settings().strategy = 'deep';
    return chain();
  },
  matchOn(fields: string | string[]): Chain {
    settings().matchOn = toList(fields);
    return chain();
  },
});

const liveMethod = <Chain>(
  property: { liveMetadata?: LivePropertyMetadata; mergeSettings?: unknown },
  chain: () => Chain,
) => ({
  live(options: LiveOptions): Chain {
    if (property.mergeSettings) throw new Error(MERGE_LIVE_ERROR);
    property.liveMetadata = addLiveListeners(property.liveMetadata, options);
    return chain();
  },
});

const onceMethod = <Chain>(
  property: { onceSettings: OnceSettings | null },
  chain: () => Chain,
) => ({
  once(options?: OnceOptions): Chain {
    property.onceSettings = toOnceSettings(options);
    return chain();
  },
});

// ---------------------------------------------------------------------------
// optional(fn) — excluded from first visit, included on partial reload
// ---------------------------------------------------------------------------

export function optional<T>(function_: () => T | Promise<T>): OptionalChain<T> {
  const property: OptionalProperty<T> = {
    [PROP_TYPE]: 'optional',
    value: function_,
    onceSettings: null,
  };
  const result: OptionalChain<T> = Object.assign(
    property,
    onceMethod(property, () => result),
    liveMethod(property, () => result),
  );
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
  const result: AlwaysChain<T> = Object.assign(
    property,
    liveMethod(property, () => result),
  );
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
    mergeSettings: null,
    onceSettings: null,
  };

  // Every merge method turns merging on
  const settings = (): MergeSettings => {
    if (property.liveMetadata) throw new Error(MERGE_LIVE_ERROR);
    property.mergeSettings ??= createMergeSettings();
    return property.mergeSettings;
  };

  const result: DeferredChain<T> = Object.assign(
    property,
    mergeMethods(settings, () => result),
    onceMethod(property, () => result),
    liveMethod(property, () => result),
    {
      rescue(): DeferredChain<T> {
        property.shouldRescue = true;
        return result;
      },
      merge(): DeferredChain<T> {
        settings();
        return result;
      },
    },
  );
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
    mergeSettings: createMergeSettings(),
  };
  const result: MergeChain<T> = Object.assign(
    property,
    mergeMethods(
      () => property.mergeSettings,
      () => result,
    ),
  );
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
// once(fn, options?) — resolved once, client caches across navigations
// ---------------------------------------------------------------------------

export function once<T>(
  function_: () => T | Promise<T>,
  options?: OnceOptions,
): OnceChain<T> {
  const property: OnceProperty<T> = {
    [PROP_TYPE]: 'once',
    value: function_,
    onceSettings: toOnceSettings(options),
  };
  const result: OnceChain<T> = Object.assign(
    property,
    liveMethod(property, () => result),
  );
  return result;
}

// ---------------------------------------------------------------------------
// scroll(value, options) — infinite scroll with pagination metadata
// ---------------------------------------------------------------------------

const previousPageOf = (options: ScrollOptions): ScrollPage | null => {
  if (options.previousPage !== undefined) return options.previousPage;
  return typeof options.page === 'number' && options.page > 1
    ? options.page - 1
    : null;
};

const nextPageOf = (options: ScrollOptions): ScrollPage | null => {
  if (options.nextPage !== undefined) return options.nextPage;
  const { page, hasMore, lastPage } = options;
  if (typeof page !== 'number') return null;
  const more = hasMore ?? (lastPage !== undefined && page < lastPage);
  return more ? page + 1 : null;
};

export function scroll<V>(
  value: V,
  options: ScrollOptions,
): ScrollChain<Resolved<V>> {
  type T = Resolved<V>;
  const property: ScrollProperty<T> = {
    [PROP_TYPE]: 'scroll',
    value: value as Lazy<T>,
    pageName: options.pageName ?? 'page',
    currentPage: options.page,
    previousPage: previousPageOf(options),
    nextPage: nextPageOf(options),
    matchOnFields: [],
  };
  const result: ScrollChain<T> = Object.assign(property, {
    matchOn(fields: string | string[]): ScrollChain<T> {
      property.matchOnFields = toList(fields);
      return result;
    },
  });
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
  const result: LiveChain<T> = Object.assign(
    property,
    liveMethod(property, () => result),
  );
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
