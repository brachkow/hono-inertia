import type { Context } from 'hono';
import type {
  LivePropertyMetadata,
  MergeSettings,
  MergeStrategy,
  OnceSettings,
  PageObject,
  PropertyHandlers,
  ScrollProperty,
  TaggedProperty,
} from './types.js';
import { isTaggedProp } from './properties.js';
import { PROP_TYPE } from './symbols.js';
import {
  getExceptOnceProperties,
  getPartialComponent,
  getPartialData,
  getPartialExcept,
  getResetProperties,
  getScrollMergeIntent,
} from './utilities.js';

// ---------------------------------------------------------------------------
// The props tree as dot paths
// ---------------------------------------------------------------------------

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || isTaggedProp(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export interface FlattenedProperties {
  // [dot path, value] for every prop that is not a branch
  leaves: Array<[string, unknown]>;
  // Dot paths of the plain objects in between, parents first
  branches: string[];
}

// Plain objects are branches, so prop types and lazy functions inside them
// work as at the top level, as in inertia-laravel. errors stays one prop: its
// keys are field names, not props. An empty object, and one with toJSON(),
// are values, not branches.
export const flattenProperties = (
  properties: Record<string, unknown>,
  prefix = '',
  result: FlattenedProperties = { leaves: [], branches: [] },
): FlattenedProperties => {
  for (const [key, value] of Object.entries(properties)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (
      path !== 'errors' &&
      isPlainObject(value) &&
      typeof value.toJSON !== 'function' &&
      Object.keys(value).length > 0
    ) {
      result.branches.push(path);
      flattenProperties(value, path, result);
    } else {
      result.leaves.push([path, value]);
    }
  }
  return result;
};

// Sets a dot path in a props object, creating the objects on the way
const setPath = (
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): void => {
  const keys = path.split('.');
  const last = keys.pop() ?? path;
  let current = target;
  for (const key of keys) {
    const next = current[key];
    if (isPlainObject(next)) {
      current = next;
    } else {
      const created: Record<string, unknown> = {};
      current[key] = created;
      current = created;
    }
  }
  current[last] = value;
};

// 'a.b.c' → ['a', 'a.b']
const ancestorsOf = (path: string): string[] => {
  const parts = path.split('.');
  return parts.slice(1).map((_, index) => parts.slice(0, index + 1).join('.'));
};

// ---------------------------------------------------------------------------
// What the request asks for
// ---------------------------------------------------------------------------

export interface PartialRequest {
  // A partial reload of this page that names props with only or except
  isPartial: boolean;
  // Named by X-Inertia-Partial-Data: the path itself, a path inside it
  // (`auth` requests `auth.user`), or a path it sits inside (`user.name`
  // requests a `user` that resolves to an object, which the client slices)
  isRequested: (path: string) => boolean;
  // Left out of a partial response by only or except. errors never is.
  isFilteredOut: (path: string) => boolean;
  // X-Inertia-Reset names it, so the client replaces it instead of merging
  isReset: (path: string) => boolean;
  // The client lists the once props it holds on every request. As in
  // inertia-laravel, only a full visit skips them: a partial reload that
  // names one asks for a fresh value.
  clientHolds: (path: string, settings: OnceSettings) => boolean;
  scrollIntent: 'append' | 'prepend';
}

// The header sets plus each named path's ancestors, so a check walks the
// path's few segments instead of every name in the header
export const readPartialRequest = (
  c: Context,
  component: string,
): PartialRequest => {
  const only = getPartialData(c);
  const except = getPartialExcept(c);
  const exceptOnce = getExceptOnceProperties(c);
  const reset = getResetProperties(c);
  const isPartial =
    getPartialComponent(c) === component && (only.size > 0 || except.size > 0);
  const insideOnly = new Set([...only].flatMap((entry) => ancestorsOf(entry)));

  const isRequested = (path: string): boolean =>
    only.has(path) ||
    insideOnly.has(path) ||
    ancestorsOf(path).some((ancestor) => only.has(ancestor));
  const isExcepted = (path: string): boolean =>
    except.has(path) ||
    ancestorsOf(path).some((ancestor) => except.has(ancestor));

  return {
    isPartial,
    isRequested,
    isFilteredOut: (path) =>
      isPartial &&
      path !== 'errors' &&
      ((only.size > 0 && !isRequested(path)) ||
        (except.size > 0 && isExcepted(path))),
    isReset: (path) => reset.has(path),
    clientHolds: (path, settings) =>
      !isPartial && exceptOnce.has(settings.key ?? path),
    scrollIntent: getScrollMergeIntent(c),
  };
};

// ---------------------------------------------------------------------------
// Which props a response sends, with their metadata
// ---------------------------------------------------------------------------

export interface MergeMetadataTargets {
  mergeProps: string[];
  prependProps: string[];
  deepMergeProps: string[];
  matchPropsOn: string[];
}

// Follows inertia-laravel: a deep merge or a root merge lists the prop, and
// merges at paths list `key.path` instead
const collectMergeMetadata = (
  key: string,
  settings: MergeSettings,
  targets: MergeMetadataTargets,
): void => {
  const atRoot =
    settings.appendPaths.length === 0 && settings.prependPaths.length === 0;
  const rootTargets: Record<MergeStrategy, string[]> = {
    append: targets.mergeProps,
    prepend: targets.prependProps,
    deep: targets.deepMergeProps,
  };
  if (settings.strategy === 'deep' || atRoot) {
    rootTargets[settings.strategy].push(key);
  } else {
    for (const path of settings.appendPaths) {
      targets.mergeProps.push(`${key}.${path}`);
    }
    for (const path of settings.prependPaths) {
      targets.prependProps.push(`${key}.${path}`);
    }
  }
  for (const field of settings.matchOn) {
    targets.matchPropsOn.push(`${key}.${field}`);
  }
};

// A scroll prop merges in the direction the client scrolled
export const scrollMergeSettings = (
  property: ScrollProperty,
  intent: 'append' | 'prepend',
): MergeSettings => ({
  strategy: intent,
  appendPaths: [],
  prependPaths: [],
  matchOn: property.matchOnFields,
});

export interface ClassifiedProperties extends MergeMetadataTargets {
  // Dot path → value, or a lazy function to call
  included: Record<string, unknown>;
  // Deferred props that are sent as null when they throw
  rescuable: Set<string>;
  deferredProps: Record<string, string[]>;
  onceProps: NonNullable<PageObject['onceProps']>;
  scrollProps: NonNullable<PageObject['scrollProps']>;
  liveProps: Record<string, LivePropertyMetadata>;
}

// For each prop type: whether this response sends the prop, and the metadata
// it adds either way
export const classifyProperties = (
  leaves: FlattenedProperties['leaves'],
  request: PartialRequest,
): ClassifiedProperties => {
  const result: ClassifiedProperties = {
    included: {},
    rescuable: new Set(),
    deferredProps: {},
    mergeProps: [],
    prependProps: [],
    deepMergeProps: [],
    matchPropsOn: [],
    onceProps: {},
    scrollProps: {},
    liveProps: {},
  };

  // The client compares expiresAt with Date.now(), so a ttl becomes a
  // timestamp when the prop is sent
  const addOnce = (path: string, settings: OnceSettings): void => {
    result.onceProps[settings.key ?? path] = {
      prop: path,
      expiresAt: settings.ttl === null ? null : Date.now() + settings.ttl,
    };
  };
  const addMerge = (path: string, settings: MergeSettings): void => {
    if (!request.isReset(path)) collectMergeMetadata(path, settings, result);
  };
  // optional() and deferred() props are sent only when a partial reload
  // names them
  const isReloaded = (path: string): boolean =>
    request.isPartial && request.isRequested(path);

  // Each returns whether the response sends the prop
  const handlers: PropertyHandlers<boolean> = {
    live: (path) => !request.isFilteredOut(path),
    always: () => true,
    optional: (path, property) => {
      const sent = isReloaded(path);
      // Listed also when left out, so the client carries over a value it holds
      if (property.onceSettings && (sent || !request.isPartial)) {
        addOnce(path, property.onceSettings);
      }
      return sent;
    },
    deferred: (path, property) => {
      const sent = isReloaded(path);
      if (sent && property.shouldRescue) result.rescuable.add(path);
      if (!sent && request.isPartial) return false;
      // A once prop the client holds isn't fetched again
      const held =
        property.onceSettings !== null &&
        request.clientHolds(path, property.onceSettings);
      if (!sent && !held) {
        (result.deferredProps[property.group] ??= []).push(path);
      }
      if (property.onceSettings) addOnce(path, property.onceSettings);
      if (property.mergeSettings) addMerge(path, property.mergeSettings);
      return sent;
    },
    merge: (path, property) => {
      if (request.isFilteredOut(path)) return false;
      addMerge(path, property.mergeSettings);
      return true;
    },
    once: (path, property) => {
      if (request.isFilteredOut(path)) return false;
      addOnce(path, property.onceSettings);
      return !request.clientHolds(path, property.onceSettings);
    },
    scroll: (path, property) => {
      if (request.isFilteredOut(path)) return false;
      result.scrollProps[path] = {
        pageName: property.pageName,
        currentPage: property.currentPage,
        previousPage: property.previousPage,
        nextPage: property.nextPage,
        // As in inertia-laravel, only X-Inertia-Reset naming the prop resets
        // the client's scroll state
        reset: request.isReset(path),
      };
      addMerge(path, scrollMergeSettings(property, request.scrollIntent));
      return true;
    },
  };

  for (const [path, value] of leaves) {
    if (!isTaggedProp(value)) {
      if (!request.isFilteredOut(path)) result.included[path] = value;
      continue;
    }
    const handler = handlers[value[PROP_TYPE]] as (
      path: string,
      property: TaggedProperty,
    ) => boolean;
    const sent = handler(path, value);
    if (sent) result.included[path] = value.value;
    // Listeners go on the first visit even for props left out of it, so the
    // client knows what to subscribe to. A partial response only carries the
    // props it refreshed; the client keeps the rest.
    const live = 'liveMetadata' in value ? value.liveMetadata : undefined;
    if (live && (sent || !request.isPartial)) result.liveProps[path] = live;
  }
  return result;
};

// ---------------------------------------------------------------------------
// Lazy values
// ---------------------------------------------------------------------------

export interface ResolveOptions {
  // Kept as empty objects, also when their props all wait for a reload
  branches: string[];
  rescuable: Set<string>;
  onRescue: (error: unknown, property: string) => void;
}

// Calls lazy values in parallel and builds the props tree. A rescuable
// deferred prop that throws is sent as null and reported instead of failing
// the response, as Laravel's defer(..., rescue: true) does.
export const resolveIncluded = async (
  included: Record<string, unknown>,
  { branches, rescuable, onRescue }: ResolveOptions,
): Promise<{ props: Record<string, unknown>; rescued: string[] }> => {
  const resolved: Record<string, unknown> = {};
  for (const branch of branches) setPath(resolved, branch, {});
  const rescued = new Set<string>();

  await Promise.all(
    Object.entries(included).map(async ([path, value]) => {
      if (typeof value !== 'function') {
        setPath(resolved, path, value);
        return;
      }
      try {
        setPath(resolved, path, await (value as () => unknown)());
      } catch (error) {
        if (!rescuable.has(path)) throw error;
        onRescue(error, path);
        setPath(resolved, path, null);
        rescued.add(path);
      }
    }),
  );

  return {
    props: resolved,
    rescued: Object.keys(included).filter((path) => rescued.has(path)),
  };
};
