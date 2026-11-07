---
description: Keep validation errors and flash data across redirects
---

# Sessions

Validation errors and flash data have to survive a redirect, but the adapter keeps no state of its own. The `session` option stores them between the request that sets them and the next page. With a `secret`, it keeps them in a signed, `HttpOnly` cookie, which also works on Cloudflare Workers:

```ts
app.use(
  inertia({
    assets,
    session: { secret: env.SESSION_SECRET },
  }),
);
```

`session` takes the options of `cookieSession()`, which builds the same store, or any store with `get` and `set` (see below).

The `secret` signs the cookie, so a client cannot plant errors or flash data. Use at least 32 random bytes and keep it out of the repository.

To rotate the secret, pass a list. The first secret signs new cookies, and every secret in the list verifies, so cookies signed with the old secret keep working until they expire. On Cloudflare Workers, where secrets live in `c.env`, pass a function that reads them per request:

```ts
session: { secret: [env.SESSION_SECRET, env.OLD_SESSION_SECRET] },

session: { secret: (c) => c.env.SESSION_SECRET },
```

The signature stops changes, not reading. Anyone who has the cookie can decode the JSON in it, so do not put secrets or personal data in `flash()` or in error messages. Pass your own server-side store if you need to.

The other options are `name` (default `inertia_session`), `maxAge` in seconds (default 300), `path`, `domain`, `sameSite` (default `Lax`) and `secure` (default `true` on HTTPS requests).

A cookie holds about 4 KB. The session keeps only the first message per field, the one pages show, so the data stays small (with `allErrors`, every message). When it is larger anyway, the cookie session throws instead of letting the browser drop the cookie. For large forms, pass your own store. It reads and writes one value per request, for example in KV, Redis or the session of another middleware:

```ts
import type { InertiaSession } from '@brachkow/hono-inertia';

// sessionId(c) is your own helper, e.g. reading a session id cookie
const kvSession: InertiaSession = {
  // Must not clear the data. The middleware calls set(c, null) once a page used it.
  get: (c) => c.env.SESSIONS.get(sessionId(c), 'json'),
  set: (c, data) =>
    data === null
      ? c.env.SESSIONS.delete(sessionId(c))
      : c.env.SESSIONS.put(sessionId(c), JSON.stringify(data)),
};
```

The middleware reads the session on each request and decides what to keep:

- A rendered page shows the stored errors and flash data, and the middleware clears them
- A redirect keeps them for the next page and adds what the handler flashed, so they survive redirect chains
- A version mismatch 409 and a prefetch leave the session untouched, so a full reload or a discarded prefetch loses nothing
- Any other response, such as JSON or a 204, keeps the stored data and adds what the handler flashed
