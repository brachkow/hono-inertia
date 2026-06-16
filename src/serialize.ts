import type { PageObject } from './types.js'

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

// HTML-escape a string so it is safe to interpolate into HTML text or an
// attribute value (used for the `data-page` attribute and for view data).
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ENTITIES[char])
}

// Serialize the page object for the root template's `data-page` attribute — the
// pattern the official Inertia client reads (`el.dataset.page`). Plain
// JSON.stringify is unsafe here because it does not escape "<", so a prop value
// containing "</script>" (or a stray '"') could break out of the attribute or a
// surrounding <script> tag. HTML-escaping the JSON neutralizes that; the browser
// decodes the entities back to valid JSON before the client parses it.
export function serializePage(page: PageObject): string {
  return escapeHtml(JSON.stringify(page))
}
