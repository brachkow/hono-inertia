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
  return JSON.stringify(page).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
}
