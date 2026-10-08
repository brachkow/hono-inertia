import type { PageObject } from './types.js'

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

// HTML-escape a string so it is safe to interpolate into HTML text or an
// attribute value (used for view data such as a <title>).
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ENTITIES[char])
}

// Serialize the page object for the `<script data-page="app" type="application/json">`
// tag the Inertia client boots from. Plain JSON.stringify is unsafe there: a prop
// value containing "</script>" or "<!--" would end the script element early and
// run as markup. Script content is raw text, so HTML entities would corrupt the
// JSON instead; JSON unicode escapes keep it valid JSON while inert as HTML.
export function serializePage(page: PageObject): string {
  return stringifyPage(page).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
}

// JSON has no BigInt, so a page holding one is sent with each BigInt as a
// { "$bigint": "<digits>" } marker and flagged with preserveBigIntegers, which
// tells the client (3.8+) to revive the markers. Mirrors stringifyPage in
// @inertiajs/core: the replacer only runs after a plain stringify fails, and
// the original error is rethrown if the retry fails too (e.g. a cycle).
export function stringifyPage(page: PageObject): string {
  try {
    return JSON.stringify(page)
  } catch (error) {
    try {
      return JSON.stringify({ ...page, preserveBigIntegers: true }, replaceBigInt)
    } catch {
      throw error
    }
  }
}

const replaceBigInt = (_key: string, value: unknown): unknown =>
  typeof value === 'bigint' ? { $bigint: value.toString() } : value
