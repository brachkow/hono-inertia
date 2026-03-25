import { describe, expect, it } from 'vitest'
import { PROP_TYPE } from '../src/symbols.js'
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
} from '../src/props.js'
import type { ScrollMetadata } from '../src/types.js'

describe('isTaggedProp', () => {
  it('returns false for plain values', () => {
    expect(isTaggedProp('string')).toBe(false)
    expect(isTaggedProp(42)).toBe(false)
    expect(isTaggedProp(null)).toBe(false)
    expect(isTaggedProp(undefined)).toBe(false)
    expect(isTaggedProp({})).toBe(false)
    expect(isTaggedProp(() => {})).toBe(false)
  })

  it('returns true for tagged props', () => {
    const meta: ScrollMetadata = {
      getPageName: () => 'page',
      getCurrentPage: () => 1,
      getPreviousPage: () => null,
      getNextPage: () => null,
    }
    expect(isTaggedProp(optional(() => 1))).toBe(true)
    expect(isTaggedProp(always(1))).toBe(true)
    expect(isTaggedProp(deferred(() => 1))).toBe(true)
    expect(isTaggedProp(merge(1))).toBe(true)
    expect(isTaggedProp(once(() => 1))).toBe(true)
    expect(isTaggedProp(scroll([1], meta))).toBe(true)
  })
})

describe('optional', () => {
  it('creates an optional prop', () => {
    const fn = () => 'value'
    const prop = optional(fn)
    expect(prop[PROP_TYPE]).toBe('optional')
    expect(prop.value).toBe(fn)
    expect(prop.isOnce).toBe(false)
  })

  it('supports .once() chaining', () => {
    const prop = optional(() => 'value').once('myKey', 3600)
    expect(prop[PROP_TYPE]).toBe('optional')
    expect(prop.isOnce).toBe(true)
    expect(prop.onceKey).toBe('myKey')
    expect(prop.expiresAt).toBe(3600)
  })
})

describe('always', () => {
  it('creates an always prop', () => {
    const prop = always('value')
    expect(prop[PROP_TYPE]).toBe('always')
    expect(prop.value).toBe('value')
  })
})

describe('deferred', () => {
  it('creates a deferred prop with default group', () => {
    const fn = () => 'data'
    const prop = deferred(fn)
    expect(prop[PROP_TYPE]).toBe('deferred')
    expect(prop.value).toBe(fn)
    expect(prop.group).toBe('default')
    expect(prop.isMerge).toBe(false)
    expect(prop.isOnce).toBe(false)
  })

  it('accepts a custom group', () => {
    const prop = deferred(() => 'data', 'sidebar')
    expect(prop.group).toBe('sidebar')
  })

  it('supports .merge() chaining', () => {
    const prop = deferred(() => []).merge()
    expect(prop.isMerge).toBe(true)
    expect(prop.mergeStrategy).toBe('append')
  })

  it('supports .prepend() chaining', () => {
    const prop = deferred(() => []).prepend()
    expect(prop.isMerge).toBe(true)
    expect(prop.mergeStrategy).toBe('prepend')
  })

  it('supports .deepMerge() chaining', () => {
    const prop = deferred(() => []).deepMerge()
    expect(prop.isMerge).toBe(true)
    expect(prop.mergeStrategy).toBe('deep')
  })

  it('supports .setMatchOn() chaining', () => {
    const prop = deferred(() => []).merge().setMatchOn('id')
    expect(prop.matchOn).toBe('id')
  })

  it('supports .once() chaining', () => {
    const prop = deferred(() => []).once('key')
    expect(prop.isOnce).toBe(true)
    expect(prop.onceKey).toBe('key')
  })

  it('supports multiple chaining', () => {
    const prop = deferred(() => [], 'sidebar').merge().once('k').setMatchOn('id')
    expect(prop.isMerge).toBe(true)
    expect(prop.isOnce).toBe(true)
    expect(prop.matchOn).toBe('id')
    expect(prop.group).toBe('sidebar')
  })
})

describe('merge', () => {
  it('creates a merge prop with append strategy', () => {
    const prop = merge([1, 2, 3])
    expect(prop[PROP_TYPE]).toBe('merge')
    expect(prop.value).toEqual([1, 2, 3])
    expect(prop.strategy).toBe('append')
    expect(prop.matchOn).toBeNull()
  })

  it('supports lazy values', () => {
    const fn = () => [1, 2, 3]
    const prop = merge(fn)
    expect(prop.value).toBe(fn)
  })

  it('supports .prepend() chaining', () => {
    const prop = merge([]).prepend()
    expect(prop.strategy).toBe('prepend')
  })

  it('supports .deepMerge() chaining', () => {
    const prop = merge({}).deepMerge()
    expect(prop.strategy).toBe('deep')
  })

  it('supports .setMatchOn() chaining', () => {
    const prop = merge([]).setMatchOn('id')
    expect(prop.matchOn).toBe('id')
  })
})

describe('prepend', () => {
  it('is sugar for merge().prepend()', () => {
    const prop = prepend([1, 2])
    expect(prop[PROP_TYPE]).toBe('merge')
    expect(prop.strategy).toBe('prepend')
  })
})

describe('deepMerge', () => {
  it('is sugar for merge().deepMerge()', () => {
    const prop = deepMerge({ a: 1 })
    expect(prop[PROP_TYPE]).toBe('merge')
    expect(prop.strategy).toBe('deep')
  })
})

describe('once', () => {
  it('creates a once prop', () => {
    const fn = () => 'plans'
    const prop = once(fn)
    expect(prop[PROP_TYPE]).toBe('once')
    expect(prop.value).toBe(fn)
    expect(prop.onceKey).toBeNull()
    expect(prop.expiresAt).toBeNull()
  })

  it('accepts key and expiresAt', () => {
    const prop = once(() => 'data', 'myKey', 7200)
    expect(prop.onceKey).toBe('myKey')
    expect(prop.expiresAt).toBe(7200)
  })
})

describe('scroll', () => {
  const mockMetadata: ScrollMetadata = {
    getPageName: () => 'page',
    getCurrentPage: () => 3,
    getPreviousPage: () => 2,
    getNextPage: () => 4,
  }

  it('creates a scroll prop with correct type tag', () => {
    const prop = scroll([1, 2], mockMetadata)
    expect(prop[PROP_TYPE]).toBe('scroll')
  })

  it('stores the value', () => {
    const data = [{ id: 1 }]
    const prop = scroll(data, mockMetadata)
    expect(prop.value).toBe(data)
  })

  it('supports lazy values', () => {
    const fn = () => [1, 2, 3]
    const prop = scroll(fn, mockMetadata)
    expect(prop.value).toBe(fn)
  })

  it('extracts pagination metadata from adapter', () => {
    const prop = scroll([], mockMetadata)
    expect(prop.pageName).toBe('page')
    expect(prop.currentPage).toBe(3)
    expect(prop.previousPage).toBe(2)
    expect(prop.nextPage).toBe(4)
  })

  it('handles null previous/next pages', () => {
    const firstPageMeta: ScrollMetadata = {
      getPageName: () => 'p',
      getCurrentPage: () => 1,
      getPreviousPage: () => null,
      getNextPage: () => null,
    }
    const prop = scroll([], firstPageMeta)
    expect(prop.previousPage).toBeNull()
    expect(prop.nextPage).toBeNull()
    expect(prop.pageName).toBe('p')
  })
})
