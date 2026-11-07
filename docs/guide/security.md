---
description: XSS, CSRF, redirects, caching and SSR trust boundaries
---

# Security

This adapter follows Inertia's official conventions, but some security work is up to you. Embed the page object with `serializePage`, escape user-controlled view data with `escapeHtml`, and add CSRF protection.

## Embedding the page object (XSS)

The Inertia client boots from a `<script data-page="app" type="application/json">` tag. Always fill it with `serializePage(page)`, never a bare `JSON.stringify(page)`. `JSON.stringify` does not escape `<`, so a prop value containing `</script>` or `<!--` (a username, comment, search term, or validation message) would end the script element early and run as HTML or JavaScript. `serializePage` escapes `<` and `>` as JSON unicode escapes, and the client parses them back unchanged.

Do not HTML-escape the output and do not put it in an attribute. Script content is raw text, so entities like `&quot;` would corrupt the JSON, and the client does not read a `data-page` attribute.

```ts
import { serializePage } from '@brachkow/hono-inertia';

render: (page) =>
  `<script data-page="app" type="application/json">${serializePage(page)}</script><div id="app"></div>`;
```

For any other user-influenced value you interpolate into HTML yourself, such as view data in a `<title>`, use `escapeHtml`:

```ts
import { escapeHtml } from '@brachkow/hono-inertia';

render: (page, viewData) =>
  `<title>${escapeHtml(String(viewData.title))}</title>
   <script data-page="app" type="application/json">${serializePage(page)}</script>
   <div id="app"></div>`;
```

## CSRF

This adapter does not provide CSRF protection, and the `X-Inertia` header is not a substitute for it. Add CSRF middleware for state-changing requests. With Hono:

```ts
import { csrf } from 'hono/csrf';

app.use(csrf());
```

The Inertia client (axios) reads the `XSRF-TOKEN` cookie and sends it back in an `X-XSRF-TOKEN` header, so a scheme that sets a cookie token and verifies the header works without extra client code.

## History encryption

By default, Inertia stores page state unencrypted in browser history, so a user who presses Back after logging out can still read the previous page's props. Encrypt history on pages with sensitive data, per request with `c.var.inertia.encryptHistory()` or globally with `inertia({ encryptHistory: true })`. Encryption uses the Web Crypto API and requires HTTPS.

Without HTTPS, encryption fails silently. `window.crypto.subtle` is undefined in non-secure contexts, for example when you test from a phone over plain HTTP on a LAN IP. The Inertia client then logs "Encryption is not supported in this environment. SSL is required." and stores history in plaintext. `localhost` counts as a secure context, so this only happens on non-localhost HTTP.

Encryption alone doesn't protect the back button either. See the back/forward cache note under [Caching](/guide/security#caching). A complete logout looks like this:

```ts
app.post('/logout', (c) => {
  deleteCookie(c, 'session'); // 1. end the session
  c.var.inertia.clearHistory(); // 2. rotate the history encryption key
  return c.redirect('/login'); //    (flashed across the redirect)
});
```

Enable `encryptHistory` on authenticated pages. If bfcache restoration matters to you, also add `Cache-Control: no-store` and a `pageshow` guard to those pages (see below).

## Redirects

`location()` and `clientRedirect()` send the URL you pass straight to the browser. Never pass unvalidated user input, such as a `?next=` parameter, to them. Validate it against an allowlist or restrict it to same-origin paths first, or you create an open redirect.

`back()` and the redirect after an empty 200 use only the path, query and fragment of the `Referer`, so a forged `Referer` cannot send users to another origin. Leading slashes and backslashes collapse to one `/`, so a path such as `//evil.example` cannot become a protocol-relative URL, and a `Referer` that is not `http:` or `https:` is ignored. The version mismatch 409 builds its `X-Inertia-Location` from the request path the same way.

## Caching

Responses the adapter emits (Inertia JSON, initial HTML, 409s) carry `Cache-Control: private, no-cache, must-revalidate` by default:

- Without a `Cache-Control` header, browsers apply heuristic freshness to the HTML document. After a deploy, the browser could answer the full-page reload that a 409 triggers with the same stale document from cache, and asset versioning would silently fail. The 409 mechanism needs this header to work.
- `private`, because the rendered HTML embeds per-user props (session, auth) in the page data script, so a shared cache or CDN must never store it.
- `no-cache` (store but revalidate) instead of `no-store`, because `no-store` disables the back/forward cache and turns every back navigation into a full load.

Override the value with `cacheControl: '…'`, or omit the header with `cacheControl: false`. For a per-route override, set the header with `c.header()` before `render()`. It applies to both initial HTML and Inertia JSON responses. 409 responses always use the config value:

```ts
app.get('/pricing', async (c) => {
  c.header('Cache-Control', 'public, max-age=300');
  return c.var.inertia.render('Pricing', { plans });
});
```

The adapter never touches responses it doesn't emit, such as your own routes.

**Back/forward cache.** The `no-cache` default does not keep pages out of the browser's back/forward cache. Bfcache stores a snapshot of the rendered page, so Safari and Firefox can restore an authenticated page on Back after logout, even with history encryption. Encryption protects the stored history state, not the rendered snapshot. `no-store` excludes the page from bfcache in Firefox and Chromium, but Safari may still cache `no-store` pages. Pair a per-route `no-store` on authenticated pages with a client-side guard:

```js
window.addEventListener('pageshow', (e) => {
  if (e.persisted) window.location.reload();
});
```

When testing, keep in mind that Chromium automation (`page.goBack()` in Playwright) triggers `popstate`, not bfcache. A passing Chromium test says nothing about Back behavior in Safari or Firefox.

## SSR

The SSR server is a trust boundary. The template inserts its `head` and `body` into the HTML as-is, because they are rendered HTML and escaping them would break the page. Only point `ssr.url` at a server you control, such as loopback or an authenticated internal host over HTTPS, and never take it from untrusted input. `ssr.timeout` and `ssr.maxResponseBytes` limit the responses. With an SSR entry or `ssr.render`, the HTML comes from your own code, and the adapter checks only its shape.
