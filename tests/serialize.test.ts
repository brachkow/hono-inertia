import { describe, expect, it } from 'vitest'
import { escapeHtml, serializePage } from '../src/serialize.js'
import type { PageObject } from '../src/types.js'

function htmlDecode(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

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

  it('does not let a prop break out of a <script> tag', () => {
    const payload = `</script><script>alert(document.cookie)</script>`
    const output = serializePage(basePage({ bio: payload }))

    expect(output).not.toContain('</script>')
    expect(output).toContain('&lt;/script&gt;')
  })

  it('round-trips to the original page object after HTML decoding', () => {
    const payload = `</script><img src=x onerror="alert(1)">`
    const output = serializePage(basePage({ bio: payload }))

    const parsed = JSON.parse(htmlDecode(output)) as PageObject
    expect(parsed.props.bio).toBe(payload)
    expect(parsed.component).toBe('Test')
  })

  it('escapes ampersands and quotes so the data-page attribute stays intact', () => {
    const output = serializePage(basePage({ note: `a & "b"` }))

    expect(output).not.toContain('"b"')
    expect(output).toContain('&amp;')
    expect(output).toContain('&quot;')
  })
})
