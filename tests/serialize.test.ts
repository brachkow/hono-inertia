import { describe, expect, it } from 'vitest'
import { escapeHtml, serializePage } from '../src/serialize.js'
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
