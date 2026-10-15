import { describe, expect, it } from 'vitest';
import { PROP_TYPE } from '../src/symbols.js';
import {
  always,
  deferred,
  deepMerge,
  isTaggedProp,
  merge,
  once,
  optional,
  prepend,
  scroll,
} from '../src/properties.js';
import type { ScrollMetadata } from '../src/types.js';

describe('isTaggedProp', () => {
  it('returns false for plain values', () => {
    expect(isTaggedProp('string')).toBe(false);
    expect(isTaggedProp(42)).toBe(false);
    expect(isTaggedProp(null)).toBe(false);
    expect(isTaggedProp(undefined)).toBe(false);
    expect(isTaggedProp({})).toBe(false);
    expect(isTaggedProp(() => {})).toBe(false);
  });

  it('returns true for tagged props', () => {
    const meta: ScrollMetadata = {
      getPageName: () => 'page',
      getCurrentPage: () => 1,
      getPreviousPage: () => null,
      getNextPage: () => null,
    };
    expect(isTaggedProp(optional(() => 1))).toBe(true);
    expect(isTaggedProp(always(1))).toBe(true);
    expect(isTaggedProp(deferred(() => 1))).toBe(true);
    expect(isTaggedProp(merge(1))).toBe(true);
    expect(isTaggedProp(once(() => 1))).toBe(true);
    expect(isTaggedProp(scroll([1], meta))).toBe(true);
  });
});

describe('optional', () => {
  it('creates an optional prop', () => {
    const function_ = () => 'value';
    const property = optional(function_);
    expect(property[PROP_TYPE]).toBe('optional');
    expect(property.value).toBe(function_);
    expect(property.isOnce).toBe(false);
  });

  it('supports .once() chaining', () => {
    const property = optional(() => 'value').once('myKey', 3600);
    expect(property[PROP_TYPE]).toBe('optional');
    expect(property.isOnce).toBe(true);
    expect(property.onceKey).toBe('myKey');
    expect(property.expiresAt).toBe(3600);
  });
});

describe('always', () => {
  it('creates an always prop', () => {
    const property = always('value');
    expect(property[PROP_TYPE]).toBe('always');
    expect(property.value).toBe('value');
  });
});

describe('deferred', () => {
  it('creates a deferred prop with default group', () => {
    const function_ = () => 'data';
    const property = deferred(function_);
    expect(property[PROP_TYPE]).toBe('deferred');
    expect(property.value).toBe(function_);
    expect(property.group).toBe('default');
    expect(property.shouldRescue).toBe(false);
    expect(property.isMerge).toBe(false);
    expect(property.isOnce).toBe(false);
  });

  it('supports .rescue() chaining', () => {
    const property = deferred(() => []).rescue();
    expect(property.shouldRescue).toBe(true);
  });

  it('accepts a custom group', () => {
    const property = deferred(() => 'data', 'sidebar');
    expect(property.group).toBe('sidebar');
  });

  it('supports .merge() chaining', () => {
    const property = deferred(() => []).merge();
    expect(property.isMerge).toBe(true);
    expect(property.mergeStrategy).toBe('append');
  });

  it('supports .prepend() chaining', () => {
    const property = deferred(() => []).prepend();
    expect(property.isMerge).toBe(true);
    expect(property.mergeStrategy).toBe('prepend');
  });

  it('supports .deepMerge() chaining', () => {
    const property = deferred(() => []).deepMerge();
    expect(property.isMerge).toBe(true);
    expect(property.mergeStrategy).toBe('deep');
  });

  it('supports .setMatchOn() chaining', () => {
    const property = deferred(() => [])
      .merge()
      .setMatchOn('id');
    expect(property.matchOn).toBe('id');
  });

  it('supports .once() chaining', () => {
    const property = deferred(() => []).once('key');
    expect(property.isOnce).toBe(true);
    expect(property.onceKey).toBe('key');
  });

  it('supports multiple chaining', () => {
    const property = deferred(() => [], 'sidebar')
      .merge()
      .once('k')
      .setMatchOn('id')
      .rescue();
    expect(property.shouldRescue).toBe(true);
    expect(property.isMerge).toBe(true);
    expect(property.isOnce).toBe(true);
    expect(property.matchOn).toBe('id');
    expect(property.group).toBe('sidebar');
  });
});

describe('merge', () => {
  it('creates a merge prop with append strategy', () => {
    const property = merge([1, 2, 3]);
    expect(property[PROP_TYPE]).toBe('merge');
    expect(property.value).toEqual([1, 2, 3]);
    expect(property.strategy).toBe('append');
    expect(property.matchOn).toBeNull();
  });

  it('supports lazy values', () => {
    const function_ = () => [1, 2, 3];
    const property = merge(function_);
    expect(property.value).toBe(function_);
  });

  it('supports .prepend() chaining', () => {
    const property = merge([]).prepend();
    expect(property.strategy).toBe('prepend');
  });

  it('supports .deepMerge() chaining', () => {
    const property = merge({}).deepMerge();
    expect(property.strategy).toBe('deep');
  });

  it('supports .setMatchOn() chaining', () => {
    const property = merge([]).setMatchOn('id');
    expect(property.matchOn).toBe('id');
  });
});

describe('prepend', () => {
  it('is sugar for merge().prepend()', () => {
    const property = prepend([1, 2]);
    expect(property[PROP_TYPE]).toBe('merge');
    expect(property.strategy).toBe('prepend');
  });
});

describe('deepMerge', () => {
  it('is sugar for merge().deepMerge()', () => {
    const property = deepMerge({ a: 1 });
    expect(property[PROP_TYPE]).toBe('merge');
    expect(property.strategy).toBe('deep');
  });
});

describe('once', () => {
  it('creates a once prop', () => {
    const function_ = () => 'plans';
    const property = once(function_);
    expect(property[PROP_TYPE]).toBe('once');
    expect(property.value).toBe(function_);
    expect(property.onceKey).toBeNull();
    expect(property.expiresAt).toBeNull();
  });

  it('accepts key and expiresAt', () => {
    const property = once(() => 'data', 'myKey', 7200);
    expect(property.onceKey).toBe('myKey');
    expect(property.expiresAt).toBe(7200);
  });
});

describe('scroll', () => {
  const mockMetadata: ScrollMetadata = {
    getPageName: () => 'page',
    getCurrentPage: () => 3,
    getPreviousPage: () => 2,
    getNextPage: () => 4,
  };

  it('creates a scroll prop with correct type tag', () => {
    const property = scroll([1, 2], mockMetadata);
    expect(property[PROP_TYPE]).toBe('scroll');
  });

  it('stores the value', () => {
    const data = [{ id: 1 }];
    const property = scroll(data, mockMetadata);
    expect(property.value).toBe(data);
  });

  it('supports lazy values', () => {
    const function_ = () => [1, 2, 3];
    const property = scroll(function_, mockMetadata);
    expect(property.value).toBe(function_);
  });

  it('extracts pagination metadata from adapter', () => {
    const property = scroll([], mockMetadata);
    expect(property.pageName).toBe('page');
    expect(property.currentPage).toBe(3);
    expect(property.previousPage).toBe(2);
    expect(property.nextPage).toBe(4);
  });

  it('handles null previous/next pages', () => {
    const firstPageMeta: ScrollMetadata = {
      getPageName: () => 'p',
      getCurrentPage: () => 1,
      getPreviousPage: () => null,
      getNextPage: () => null,
    };
    const property = scroll([], firstPageMeta);
    expect(property.previousPage).toBeNull();
    expect(property.nextPage).toBeNull();
    expect(property.pageName).toBe('p');
  });

  it('defaults matchOn to null', () => {
    const property = scroll([], mockMetadata);
    expect(property.matchOn).toBeNull();
  });

  it('supports .setMatchOn() chaining', () => {
    const property = scroll([], mockMetadata).setMatchOn('id');
    expect(property.matchOn).toBe('id');
  });

  it('preserves pagination metadata through .setMatchOn()', () => {
    const property = scroll([], mockMetadata).setMatchOn('id');
    expect(property.currentPage).toBe(3);
    expect(property.nextPage).toBe(4);
  });
});
