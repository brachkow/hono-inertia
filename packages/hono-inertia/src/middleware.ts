import { createMiddleware } from 'hono/factory';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Context, Env, MiddlewareHandler, Next } from 'hono';
import type { InertiaConfig, InertiaEnv } from './types.js';
import type { InertiaSharedEnv } from './page-properties.js';
import { InertiaResponse } from './response.js';
import {
  beginDevtoolsRecording,
  handleDevtoolsRequest,
  recordDevtoolsEntry,
  resolveDevtools,
} from './devtools.js';
import {
  cacheControlValue,
  getRequestVersion,
  isInertiaRequest,
  isPrefetch,
  resolveUrl,
} from './utilities.js';

export const CLEAR_HISTORY_COOKIE = 'inertia_clear_history';
export const PRESERVE_FRAGMENT_COOKIE = 'inertia_preserve_fragment';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// clearHistory and preserveFragment only land on a rendered page object, but
// handlers that set them often redirect, and logout handlers answer 204.
// Laravel keeps the flags in the session until the next page render. This
// adapter works without a session, so each flag uses a short-lived cookie.
interface FlashedFlag {
  cookie: string;
  set: (response: InertiaResponse) => void;
  pending: (response: InertiaResponse) => boolean;
  consumed: (response: InertiaResponse) => boolean;
}

const FLASHED_FLAGS: FlashedFlag[] = [
  {
    cookie: CLEAR_HISTORY_COOKIE,
    set: (response) => response.clearHistory(),
    pending: (response) => response.clearHistoryPending,
    consumed: (response) => response.clearHistoryConsumed,
  },
  {
    cookie: PRESERVE_FRAGMENT_COOKIE,
    set: (response) => response.preserveFragment(),
    pending: (response) => response.preserveFragmentPending,
    consumed: (response) => response.preserveFragmentConsumed,
  },
];

const isRedirectShaped = (response: Response): boolean =>
  REDIRECT_STATUSES.has(response.status) ||
  (response.status === 409 &&
    (response.headers.has('X-Inertia-Redirect') ||
      response.headers.has('X-Inertia-Location')));

// V comes from share(). The returned middleware records it in the app's Env,
// where PageProps finds it.
export function inertia<
  V extends Record<string, unknown> = Record<string, unknown>,
>(
  config: InertiaConfig<V>,
): MiddlewareHandler<InertiaEnv & InertiaSharedEnv<V>> {
  const devtools = resolveDevtools(config.devtools);

  return createMiddleware<InertiaEnv & InertiaSharedEnv<V>>(async (c, next) => {
    if (devtools) {
      const handled = await handleDevtoolsRequest(c, devtools);
      if (handled) return handled;
    }

    const recording = devtools ? beginDevtoolsRecording(c) : null;
    const response = await handle(c, next, config);

    if (devtools && recording) {
      await recordDevtoolsEntry(
        c,
        devtools,
        recording,
        response?.devtoolsPayload ?? null,
      );
    }
  });
}

// Runs the Inertia request lifecycle, leaving the final response on `c.res`.
// Returns the InertiaResponse when the handler ran, null on a version 409.
async function handle<V extends Record<string, unknown>>(
  c: Context<InertiaEnv & InertiaSharedEnv<V>>,
  next: Next,
  config: InertiaConfig<V>,
): Promise<InertiaResponse | null> {
  // Current asset version, resolved lazily and at most once per request —
  // a version thunk must not run on passthrough routes or POSTs that never
  // need it. Not cached across requests: a thunk may intentionally be live.
  let resolved: Promise<string | null> | undefined;
  const currentVersion = (): Promise<string | null> => {
    resolved ??=
      config.version === undefined
        ? Promise.resolve(null)
        : Promise.resolve(
            typeof config.version === 'function'
              ? config.version()
              : config.version,
          );
    return resolved;
  };

  // Version conflict check (before handler, GET only). A missing or empty
  // X-Inertia-Version never 409s, and a null server version means
  // versioning is disabled — both per Inertia protocol (matches Laravel).
  if (isInertiaRequest(c) && c.req.method === 'GET') {
    const clientVersion = getRequestVersion(c);
    if (clientVersion) {
      const version = await currentVersion();
      if (version !== null && clientVersion !== version) {
        const cacheControl = cacheControlValue(config);
        c.res = c.body(null, 409, {
          // Relative path (not c.req.url): an absolute URL would send the client
          // to the internal origin behind a proxy. Matches page.url's format.
          'X-Inertia-Location': resolveUrl(c),
          // Lets the client tell a deploy-driven reload apart from a plain
          // location redirect: background async visits skip the forced reload
          // and `inertia:location` reports versionChange.
          'X-Inertia-Version': version,
          Vary: 'X-Inertia',
          ...(cacheControl !== undefined && { 'Cache-Control': cacheControl }),
        });
        return null;
      }
    }
  }

  // Read after the version check, so a 409 leaves the session for the full
  // reload that follows. Prefetches skip it: the client may discard a
  // prefetched page, which would swallow errors and flash data unseen.
  const incomingSession =
    config.session && !isPrefetch(c)
      ? ((await config.session.get(c)) ?? null)
      : null;

  // Create response builder and attach to context
  const response = new InertiaResponse(
    c,
    config,
    currentVersion,
    incomingSession,
  );
  c.set('inertia', response);

  // Apply global shared props
  if (config.share) {
    const shared = await config.share(c);
    response.share(shared);
  }

  // Apply global history encryption (per-request opt-out still possible)
  if (config.encryptHistory) {
    response.encryptHistory(true);
  }

  // Consume the flags a preceding redirect flashed. Prefetches are skipped:
  // a prefetched page may be discarded client-side, which would swallow a
  // flag without the page ever showing it.
  const inheritedFlags = new Set(
    FLASHED_FLAGS.filter(
      (flag) => !isPrefetch(c) && getCookie(c, flag.cookie) !== undefined,
    ),
  );
  for (const flag of inheritedFlags) flag.set(response);

  await next();

  // An empty 200 means the handler had nothing to show, e.g. it saved a form
  // and returned c.body(null). Laravel's adapter redirects back then.
  if (isInertiaRequest(c) && c.res.status === 200 && c.res.body === null) {
    // The c.res setter carries over the headers the handler set
    c.res = new Response(null, {
      status: 302,
      headers: { Location: response.backUrl() },
    });
  }

  // A redirect to a URL with a fragment: the client cannot read the fragment
  // of a redirect its HTTP client followed, so it is told to visit the full
  // URL itself. Prefetches get the redirect unchanged, per the protocol.
  const redirectTarget = c.res.headers.get('Location');
  if (
    isInertiaRequest(c) &&
    !isPrefetch(c) &&
    REDIRECT_STATUSES.has(c.res.status) &&
    redirectTarget?.includes('#')
  ) {
    const cacheControl = cacheControlValue(config);
    // Hono's c.res setter copies the old response's headers onto the new one,
    // so Location goes from the old response first
    c.res.headers.delete('Location');
    c.res = new Response(null, {
      status: 409,
      headers: {
        'X-Inertia-Redirect': redirectTarget,
        ...(cacheControl !== undefined && { 'Cache-Control': cacheControl }),
      },
    });
  }

  // Post-handler: convert 302 → 303 after PUT/PATCH/DELETE/QUERY on Inertia
  // requests, so the browser follows with GET
  if (
    isInertiaRequest(c) &&
    c.res.status === 302 &&
    ['PUT', 'PATCH', 'DELETE', 'QUERY'].includes(c.req.method)
  ) {
    const location = c.res.headers.get('Location') || '/';
    const headers = new Headers(c.res.headers);
    headers.set('Location', location);
    headers.set('Vary', 'X-Inertia');
    c.res = new Response(null, {
      status: 303,
      headers,
    });
  }

  // Flash each flag to the next page render: set the cookie when the handler
  // asked for it on a response that is not a page, re-flash it across
  // redirect chains, delete it once render() put it on the page (or the
  // handler cancelled it), and otherwise leave an inherited cookie untouched,
  // so a parallel non-page request neither eats nor resurrects the flag.
  // Max-Age bounds stray cookies.
  for (const flag of FLASHED_FLAGS) {
    const inherited = inheritedFlags.has(flag);
    const pending = flag.pending(response);
    const consumed = flag.consumed(response);
    if (pending && !consumed && (!inherited || isRedirectShaped(c.res))) {
      setCookie(c, flag.cookie, '1', {
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
        maxAge: 60,
        secure: new URL(c.req.url).protocol === 'https:',
      });
    } else if (inherited && (consumed || !pending)) {
      deleteCookie(c, flag.cookie, { path: '/' });
    }
  }

  const sessionAfter = response.sessionAfter;
  if (config.session) {
    if (sessionAfter !== undefined) {
      await config.session.set(c, sessionAfter);
    }
  } else if (sessionAfter?.errors) {
    // Errors that no page showed would be lost. Flash data without a session
    // stays limited to the current response, as it always was.
    throw new Error(
      '[hono-inertia] withErrors() before a redirect needs the `session` option to keep the errors for the next page',
    );
  }

  // Ensure Vary: X-Inertia on all responses
  const vary = c.res.headers.get('Vary');
  if (!vary) {
    c.res.headers.set('Vary', 'X-Inertia');
  } else if (!vary.includes('X-Inertia')) {
    c.res.headers.set('Vary', `${vary}, X-Inertia`);
  }

  return response;
}

// Shares props from a middleware that runs after inertia(), such as one that
// needs the session loaded first, and records their type for PageProps.
// Annotate the context with the app's Env to read what earlier middlewares
// set. Return undefined to share nothing, on routes that render no page, such
// as proxied or asset paths: PageProps still lists these props.
export const inertiaShare = <
  V extends Record<string, unknown>,
  E extends Env = Env,
>(
  share: (c: Context<E>) => V | undefined | Promise<V | undefined>,
): MiddlewareHandler<E & InertiaSharedEnv<V>> =>
  createMiddleware<E & InertiaSharedEnv<V>>(async (c, next) => {
    // The middleware's Env need not mention the inertia variable
    const response = (c as unknown as Context<InertiaEnv>).var.inertia as
      InertiaEnv['Variables']['inertia'] | undefined;
    if (!response) {
      throw new Error(
        '[hono-inertia] inertiaShare() runs after the inertia() middleware',
      );
    }
    const data = await share(c as unknown as Context<E>);
    if (data) response.share(data);
    await next();
  });
