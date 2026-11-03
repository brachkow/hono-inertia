import type { Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import type { InertiaSession, SessionData } from './types.js';

export type CookieSecret = string | BufferSource;

export interface CookieSessionOptions {
  // HMAC key that signs the cookie, so a client cannot plant errors or flash
  // data. Keep it secret and at least 32 random bytes. With a list, the first
  // key signs and every key verifies, so a new key can replace an old one
  // without dropping cookies already sent. A function reads it per request,
  // e.g. from c.env on Cloudflare Workers.
  secret:
    | CookieSecret
    | CookieSecret[]
    | ((c: Context) => CookieSecret | CookieSecret[]);
  // Defaults to 'inertia_session'
  name?: string;
  // Seconds the data waits for the next page. Defaults to 300.
  maxAge?: number;
  path?: string;
  domain?: string;
  sameSite?: 'Strict' | 'Lax' | 'None';
  // Defaults to true on https requests
  secure?: boolean;
}

// Browsers drop a cookie over 4096 bytes without telling anyone. The rest of
// the budget goes to the name, the signature and the attributes.
const MAX_VALUE_BYTES = 3800;

const resolveSecrets = (
  secret: CookieSessionOptions['secret'],
  c: Context,
): CookieSecret[] => {
  const resolved = typeof secret === 'function' ? secret(c) : secret;
  const secrets = Array.isArray(resolved) ? resolved : [resolved];
  if (secrets.length === 0) {
    throw new Error('[hono-inertia] cookieSession() needs a secret');
  }
  return secrets;
};

// A signed, HttpOnly cookie that holds errors and flash data from one request
// until the next page renders. Stateless, so it works on Workers too.
export const cookieSession = (
  options: CookieSessionOptions,
): InertiaSession => {
  const name = options.name ?? 'inertia_session';
  const path = options.path ?? '/';

  return {
    async get(c: Context): Promise<SessionData | null> {
      let raw: string | undefined;
      for (const secret of resolveSecrets(options.secret, c)) {
        // false for a bad signature, undefined for no cookie
        const value = await getSignedCookie(c, secret, name);
        if (value === undefined) return null;
        if (value !== false) {
          raw = value;
          break;
        }
      }
      if (raw === undefined) return null;
      try {
        const data: unknown = JSON.parse(raw);
        return data !== null && typeof data === 'object' ? data : null;
      } catch {
        return null;
      }
    },

    async set(c: Context, data: SessionData | null): Promise<void> {
      if (data === null) {
        deleteCookie(c, name, { path, domain: options.domain });
        return;
      }

      const value = JSON.stringify(data);
      if (encodeURIComponent(value).length > MAX_VALUE_BYTES) {
        throw new Error(
          `[hono-inertia] session data is over ${MAX_VALUE_BYTES} bytes, more than a cookie holds. Pass a server-side store as the \`session\` option instead.`,
        );
      }

      const [signingSecret] = resolveSecrets(options.secret, c);
      await setSignedCookie(c, name, value, signingSecret, {
        path,
        domain: options.domain,
        httpOnly: true,
        sameSite: options.sameSite ?? 'Lax',
        secure: options.secure ?? new URL(c.req.url).protocol === 'https:',
        maxAge: options.maxAge ?? 300,
      });
    },
  };
};
