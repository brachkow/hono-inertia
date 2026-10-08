import { describe, expect, it } from 'vitest'
import { escapeHtml, serializePage, stringifyPage } from '../src/serialize.js'
import type { PageObject } from '../src/types.js'

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<b class="x">Tom & 'Jerry'</b>`)).toBe(
      '&lt;b class=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/b&gt;',
    )
  })

  it('leaves safe text unchanged', () => {
    expect(escapeHtml('plain text 123')).toBe('plain text 123')
  })
})

describe('serializePage', () => {
  const basePage = (props: Record<string, unknown>): PageObject => ({
    component: 'Test',
    props,
    url: '/test',
    version: '1.0',
  })

  it('does not let a prop close the <script> tag', () => {
    const payload = `</script><script>alert(document.cookie)</script>`
    const output = serializePage(basePage({ bio: payload }))

    expect(output).not.toContain('<')
    expect(output).toContain('\\u003c/script\\u003e')
  })

  it('does not let a prop open an HTML comment', () => {
    const output = serializePage(basePage({ bio: '<!-- <script>' }))

    expect(output).not.toContain('<!--')
  })

  it('stays valid JSON that parses back to the original page object', () => {
    const payload = `</script><img src=x onerror="alert(1)">`
    const output = serializePage(basePage({ bio: payload, note: `a & "b"` }))

    const parsed = JSON.parse(output) as PageObject
    expect(parsed.props.bio).toBe(payload)
    expect(parsed.props.note).toBe(`a & "b"`)
    expect(parsed.component).toBe('Test')
  })

  it('does not HTML-entity encode, which would corrupt script content', () => {
    const output = serializePage(basePage({ note: `a & "b"` }))

    expect(output).not.toContain('&amp;')
    expect(output).not.toContain('&quot;')
  })
})

describe('stringifyPage', () => {
  const basePage = (props: Record<string, unknown>): PageObject => ({
    component: 'Test',
    props,
    url: '/test',
    version: '1.0',
  })

  it('leaves a page without BigInt values as plain JSON', () => {
    const page = basePage({ id: 42 })

    expect(stringifyPage(page)).toBe(JSON.stringify(page))
  })

  it('writes a BigInt as a $bigint marker and flags the page', () => {
    const parsed = JSON.parse(stringifyPage(basePage({ id: 900719925474099988n })))

    expect(parsed.props.id).toEqual({ $bigint: '900719925474099988' })
    expect(parsed.preserveBigIntegers).toBe(true)
  })

  it('writes BigInt values nested in objects and arrays', () => {
    const parsed = JSON.parse(stringifyPage(basePage({ order: { ids: [1n, 2] } })))

    expect(parsed.props.order.ids).toEqual([{ $bigint: '1' }, 2])
  })

  it('writes BigInt values in flash data', () => {
    const parsed = JSON.parse(stringifyPage({ ...basePage({}), flash: { createdId: 7n } }))

    expect(parsed.flash.createdId).toEqual({ $bigint: '7' })
  })

  it('does not flag a page that sends its own $bigint objects', () => {
    const parsed = JSON.parse(stringifyPage(basePage({ value: { $bigint: '1' } })))

    expect(parsed.preserveBigIntegers).toBeUndefined()
  })

  it('rethrows the original error for a circular structure', () => {
    const props: Record<string, unknown> = {}
    props.self = props

    expect(() => stringifyPage(basePage(props))).toThrow(/circular/i)
  })
})

describe('serializePage with BigInt values', () => {
  it('embeds BigInt markers and the preserveBigIntegers flag', () => {
    const output = serializePage({ component: 'Test', props: { id: 10n }, url: '/test', version: '1.0' })

    expect(JSON.parse(output)).toMatchObject({ props: { id: { $bigint: '10' } }, preserveBigIntegers: true })
  })
})
