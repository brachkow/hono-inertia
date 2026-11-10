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

const ROOT_APPEND = {
  strategy: 'append',
  appendPaths: [],
  prependPaths: [],
  matchOn: [],
};

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
    expect(isTaggedProp(optional(() => 1))).toBe(true);
    expect(isTaggedProp(always(1))).toBe(true);
    expect(isTaggedProp(deferred(() => 1))).toBe(true);
    expect(isTaggedProp(merge(1))).toBe(true);
    expect(isTaggedProp(once(() => 1))).toBe(true);
    expect(isTaggedProp(scroll([1], { page: 1 }))).toBe(true);
  });

  it('ignores an object with the tag name as a string key', () => {
    expect(isTaggedProp({ 'hono-inertia.prop-type': 'optional' })).toBe(false);
  });

  it('tags props with a registered symbol', () => {
    expect(PROP_TYPE).toBe(Symbol.for('hono-inertia.prop-type'));
  });
});

describe('optional', () => {
  it('creates an optional prop', () => {
    const function_ = () => 'value';
    const property = optional(function_);
    expect(property[PROP_TYPE]).toBe('optional');
    expect(property.value).toBe(function_);
    expect(property.onceSettings).toBeNull();
  });

  it('supports .once() chaining', () => {
    const property = optional(() => 'value').once({ key: 'myKey', ttl: 3600 });
    expect(property.onceSettings).toEqual({ key: 'myKey', ttl: 3600 });
  });

  it('supports .once() without options', () => {
    const property = optional(() => 'value').once();
    expect(property.onceSettings).toEqual({ key: null, ttl: null });
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
    expect(property.mergeSettings).toBeNull();
    expect(property.onceSettings).toBeNull();
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
    expect(property.mergeSettings).toEqual(ROOT_APPEND);
  });

  it('supports .prepend() chaining', () => {
    const property = deferred(() => []).prepend();
    expect(property.mergeSettings?.strategy).toBe('prepend');
  });

  it('supports .deepMerge() chaining', () => {
    const property = deferred(() => []).deepMerge();
    expect(property.mergeSettings?.strategy).toBe('deep');
  });

  it('turns merging on with .matchOn()', () => {
    const property = deferred(() => []).matchOn('id');
    expect(property.mergeSettings?.matchOn).toEqual(['id']);
  });

  it('supports .once() chaining', () => {
    const property = deferred(() => []).once({ key: 'key' });
    expect(property.onceSettings).toEqual({ key: 'key', ttl: null });
  });

  it('supports multiple chaining', () => {
    const property = deferred(() => [], 'sidebar')
      .merge()
      .once({ key: 'k' })
      .matchOn('id')
      .rescue();
    expect({
      shouldRescue: property.shouldRescue,
      mergeSettings: property.mergeSettings,
      onceSettings: property.onceSettings,
      group: property.group,
    }).toEqual({
      shouldRescue: true,
      mergeSettings: { ...ROOT_APPEND, matchOn: ['id'] },
      onceSettings: { key: 'k', ttl: null },
      group: 'sidebar',
    });
  });
});

describe('merge', () => {
  it('creates a merge prop that appends at the root', () => {
    const property = merge([1, 2, 3]);
    expect(property[PROP_TYPE]).toBe('merge');
    expect(property.value).toEqual([1, 2, 3]);
    expect(property.mergeSettings).toEqual(ROOT_APPEND);
  });

  it('supports lazy values', () => {
    const function_ = () => [1, 2, 3];
    const property = merge(function_);
    expect(property.value).toBe(function_);
  });

  it('supports .prepend() chaining', () => {
    const property = merge([]).prepend();
    expect(property.mergeSettings.strategy).toBe('prepend');
  });

  it('supports .deepMerge() chaining', () => {
    const property = merge({}).deepMerge();
    expect(property.mergeSettings.strategy).toBe('deep');
  });

  it('takes one field for .matchOn()', () => {
    const property = merge([]).matchOn('id');
    expect(property.mergeSettings.matchOn).toEqual(['id']);
  });

  it('takes several fields for .matchOn()', () => {
    const property = merge([]).matchOn(['id', 'slug']);
    expect(property.mergeSettings.matchOn).toEqual(['id', 'slug']);
  });

  it('appends at a path, matched on a field of it', () => {
    const property = merge({ data: [] }).append('data', 'id');
    expect(property.mergeSettings).toEqual({
      ...ROOT_APPEND,
      appendPaths: ['data'],
      matchOn: ['data.id'],
    });
  });

  it('prepends at a path', () => {
    const property = merge({ data: [] }).prepend('data');
    expect(property.mergeSettings).toEqual({
      ...ROOT_APPEND,
      prependPaths: ['data'],
    });
  });
});

describe('prepend', () => {
  it('is sugar for merge().prepend()', () => {
    const property = prepend([1, 2]);
    expect(property[PROP_TYPE]).toBe('merge');
    expect(property.mergeSettings.strategy).toBe('prepend');
  });
});

describe('deepMerge', () => {
  it('is sugar for merge().deepMerge()', () => {
    const property = deepMerge({ a: 1 });
    expect(property[PROP_TYPE]).toBe('merge');
    expect(property.mergeSettings.strategy).toBe('deep');
  });
});

describe('once', () => {
  it('creates a once prop', () => {
    const function_ = () => 'plans';
    const property = once(function_);
    expect(property[PROP_TYPE]).toBe('once');
    expect(property.value).toBe(function_);
    expect(property.onceSettings).toEqual({ key: null, ttl: null });
  });

  it('accepts a key and a ttl', () => {
    const property = once(() => 'data', { key: 'myKey', ttl: 7200 });
    expect(property.onceSettings).toEqual({ key: 'myKey', ttl: 7200 });
  });
});

describe('scroll', () => {
  const pagination = (property: ReturnType<typeof scroll>) => ({
    pageName: property.pageName,
    currentPage: property.currentPage,
    previousPage: property.previousPage,
    nextPage: property.nextPage,
  });

  it('creates a scroll prop with correct type tag', () => {
    const property = scroll([1, 2], { page: 1 });
    expect(property[PROP_TYPE]).toBe('scroll');
  });

  it('stores the value', () => {
    const data = [{ id: 1 }];
    const property = scroll(data, { page: 1 });
    expect(property.value).toBe(data);
  });

  it('supports lazy values', () => {
    const function_ = () => [1, 2, 3];
    const property = scroll(function_, { page: 1 });
    expect(property.value).toBe(function_);
  });

  it('works out the pages from hasMore', () => {
    const property = scroll([], { page: 3, hasMore: true });
    expect(pagination(property)).toEqual({
      pageName: 'page',
      currentPage: 3,
      previousPage: 2,
      nextPage: 4,
    });
  });

  it('has no next page when hasMore is false', () => {
    const property = scroll([], { page: 3, hasMore: false });
    expect(property.nextPage).toBeNull();
  });

  it('works out the next page from lastPage', () => {
    const property = scroll([], { page: 2, lastPage: 3 });
    expect(property.nextPage).toBe(3);
  });

  it('has no next page on the last page', () => {
    const property = scroll([], { page: 3, lastPage: 3 });
    expect(property.nextPage).toBeNull();
  });

  it('has no previous page on the first page', () => {
    const property = scroll([], { page: 1, hasMore: true });
    expect(property.previousPage).toBeNull();
  });

  it('takes cursors and a page name as given', () => {
    const property = scroll([], {
      page: 'c2',
      pageName: 'cursor',
      previousPage: 'c1',
      nextPage: 'c3',
    });
    expect(pagination(property)).toEqual({
      pageName: 'cursor',
      currentPage: 'c2',
      previousPage: 'c1',
      nextPage: 'c3',
    });
  });

  it('has no pages next to a cursor it was not given', () => {
    const property = scroll([], { page: 'c2', hasMore: true });
    expect({
      previousPage: property.previousPage,
      nextPage: property.nextPage,
    }).toEqual({ previousPage: null, nextPage: null });
  });

  it('defaults matchOn to no fields', () => {
    const property = scroll([], { page: 1 });
    expect(property.matchOnFields).toEqual([]);
  });

  it('supports .matchOn() chaining', () => {
    const property = scroll([], { page: 1 }).matchOn('id');
    expect(property.matchOnFields).toEqual(['id']);
  });
});
