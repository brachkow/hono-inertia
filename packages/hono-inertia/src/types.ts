import type { Context } from 'hono';
import type { PageName, RenderResponse } from './page-properties.js';

// ---------------------------------------------------------------------------
// Page object (sent to the Inertia client)
// ---------------------------------------------------------------------------

export interface PageObject {
  component: string;
  props: Record<string, unknown>;
  url: string;
  version: string | null;
  encryptHistory?: boolean;
  clearHistory?: boolean;
  preserveFragment?: boolean;
  // Set while serializing when props hold a BigInt (see stringifyPage)
  preserveBigIntegers?: boolean;
  sharedProps?: string[];
  flash?: Record<string, unknown>;
  rescuedProps?: string[];
  deferredProps?: Record<string, string[]>;
  mergeProps?: string[];
  prependProps?: string[];
  deepMergeProps?: string[];
  matchPropsOn?: string[];
  onceProps?: Record<string, { prop: string; expiresAt?: number | null }>;
  scrollProps?: Record<
    string,
    {
      pageName: string;
      previousPage: number | null;
      nextPage: number | null;
      currentPage: number;
      reset: boolean;
    }
  >;
  liveProps?: Record<string, LivePropertyMetadata>;
}

// ---------------------------------------------------------------------------
// Live props (client 3.10+)
// ---------------------------------------------------------------------------

export type LiveChannelType =
  'public' | 'private' | 'presence' | 'encrypted-private';

// Names go to the client unprefixed: the client's transport adds whatever
// prefix its broadcaster expects (e.g. Pusher's `private-`).
export interface LiveChannel {
  name: string;
  type: LiveChannelType;
  // Passed to the client transport untouched
  params?: Record<string, unknown>;
}

export interface LiveOptions {
  // A bare string is a public channel
  channel: string | LiveChannel | Array<string | LiveChannel>;
  // Broadcast event names that refresh the prop
  on: string | string[];
  // Refresh at most once per this many ms. The client default is 1000.
  throttle?: number;
}

export interface LiveListener {
  channel: LiveChannel;
  events: string[];
}

export interface LivePropertyMetadata {
  listeners: LiveListener[];
  throttle?: number;
}

// ---------------------------------------------------------------------------
// Session (validation errors and flash data across redirects)
// ---------------------------------------------------------------------------

// Error messages for one field. Precognition responses send every message;
// pages get the first one, as Laravel's adapter does by default.
export type ValidationErrors = Record<string, string | string[]>;

export interface SessionData {
  // Keyed by error bag name. withErrors() without a bag writes `default`.
  errors?: Record<string, ValidationErrors>;
  flash?: Record<string, unknown>;
}

// Holds what one request leaves for the next: validation errors and flash
// data. get() must not clear anything, because the middleware decides when the
// data was used and calls set(c, null) then. cookieSession() is the built-in
// store.
export interface InertiaSession {
  get(
    c: Context,
  ): SessionData | null | undefined | Promise<SessionData | null | undefined>;
  set(c: Context, data: SessionData | null): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// SSR
// ---------------------------------------------------------------------------

// What an Inertia SSR entry's default export returns
export interface SsrRenderResult {
  head: string[];
  body: string;
}

// Posts the page to `${url}/render` on an Inertia SSR server (`createServer`)
export interface SsrHttpConfig {
  enabled?: boolean;
  url?: string;
  // Abort the SSR request after this many ms (default 5000), falling back to CSR.
  timeout?: number;
  // Reject SSR responses larger than this many bytes (default 2_000_000).
  maxResponseBytes?: number;
  render?: never;
}

// Renders in the same process, e.g. a Worker that imports the SSR entry
export interface SsrRenderConfig {
  enabled?: boolean;
  render: (page: PageObject) => SsrRenderResult | Promise<SsrRenderResult>;
  url?: never;
  timeout?: never;
  maxResponseBytes?: never;
}

export type SsrConfig = SsrHttpConfig | SsrRenderConfig;

export interface SsrResult {
  head: string;
  body: string;
}

// ---------------------------------------------------------------------------
// Render function (user-provided)
// ---------------------------------------------------------------------------

export type RenderFunction = (
  page: PageObject,
  viewData: Record<string, unknown>,
  ssr: SsrResult | undefined,
  c: Context,
) => string | Promise<string>;

// ---------------------------------------------------------------------------
// Middleware configuration
// ---------------------------------------------------------------------------

// V is what share() returns. PageProps adds it to every page's props.
export interface InertiaConfig<
  V extends Record<string, unknown> = Record<string, unknown>,
> {
  // Asset version. Omitting it disables version checks (page.version: null).
  // Keep the value short — the client echoes it back as a request header.
  version?: string | (() => string | Promise<string>);
  render: RenderFunction;
  ssr?: SsrConfig;
  share?: (c: Context) => V | Promise<V>;
  // The page.url sent to the client. Defaults to the request's path and query.
  // A relative URL resolves against the request URL, and the origin is dropped.
  // c.var.inertia.url() overrides it for one response.
  resolveUrl?: (c: Context) => string;
  // Encrypt browser history state for every response (mirrors Inertia's global
  // `history.encrypt` option). Off by default; pages can opt out per-request via
  // `c.var.inertia.encryptHistory(false)`. Requires the client to be served over HTTPS.
  encryptHistory?: boolean;
  // Cache-Control for adapter-emitted responses (JSON, HTML, 409s). Defaults to
  // 'private, no-cache, must-revalidate'; set false to omit the header.
  cacheControl?: string | false;
  // Called when a `deferred(fn).rescue()` prop throws while resolving. The prop
  // is sent as null and listed in `page.rescuedProps`. Defaults to console.error.
  onRescue?: (error: unknown, property: string) => void;
  // Called when SSR fails. The page then renders client-side (ssr is undefined
  // in render). Throw from it to fail the request instead. Defaults to console.error.
  onSsrError?: (error: unknown, page: PageObject) => void;
  // Record requests for the Inertia DevTools browser extension. Off by default;
  // enable in development only. See README → DevTools.
  devtools?: boolean | DevtoolsConfig;
  // Carries validation errors and flash data across redirects. Without it,
  // flash() applies to the current response only, and withErrors() works only
  // when the handler renders a page afterwards.
  // See README → Validation and sessions.
  session?: InertiaSession;
}

// ---------------------------------------------------------------------------
// DevTools (https://inertiajs.com/docs/devtools-protocol)
// ---------------------------------------------------------------------------

export interface DevtoolsConfig {
  // Gate for the read endpoints. Every request is allowed when omitted, since
  // enabling devtools is already an explicit development switch.
  authorize?: (c: Context) => boolean | Promise<boolean>;
  // Path the app is served from when it is not the origin root, e.g. '/portal'.
  basePath?: string;
  // Prop/body keys and header names replaced with '[REDACTED]' in entries.
  // Each list replaces the default one.
  redact?: { keys?: string[]; headers?: string[] };
  // Where entries live. Defaults to an in-memory store per inertia() instance.
  store?: DevtoolsStore;
  // Resolve a page component name to its source path for editor links.
  componentPath?: (component: string) => string | null;
}

export interface DevtoolsStore {
  set(entry: DevtoolsEntry): void | Promise<void>;
  get(
    id: string,
  ): DevtoolsEntry | undefined | Promise<DevtoolsEntry | undefined>;
  // Newest first.
  all(): DevtoolsEntry[] | Promise<DevtoolsEntry[]>;
}

export type DevtoolsRequestType =
  | 'navigate'
  | 'partial'
  | 'deferred'
  | 'poll'
  | 'prefetch'
  | 'initial'
  | 'http'
  | 'precognition';

export type DevtoolsBodyCapture =
  | { status: 'empty' }
  | { status: 'present'; value: unknown }
  | { status: 'omitted'; reason: string };

export interface DevtoolsPropMeta {
  shared: boolean;
  inertiaType:
    'always' | 'defer' | 'optional' | 'merge' | 'scroll' | 'once' | null;
  deferGroup?: string;
  reset?: boolean;
  once?: boolean;
  mergeDirection?: 'append' | 'prepend';
  deepMerge?: boolean;
  rescued?: boolean;
  live?: boolean;
}

export interface DevtoolsEntry {
  __meta: {
    id: string;
    tabUuid: string | null;
    batchId: string | null;
    timestamp: string;
    utime: number;
    method: string;
    url: string;
    component: string | null;
    requestType: DevtoolsRequestType;
    status: number;
    redirectLocation: string | null;
    serverTimingMs: number;
    visitId: string | null;
  };
  http: {
    requestHeaders: Record<string, string>;
    responseHeaders: Record<string, string>;
    requestBody: DevtoolsBodyCapture;
    responseBody: DevtoolsBodyCapture;
  };
  props: Record<string, DevtoolsPropMeta>;
  propValues: Record<string, unknown>;
  route: { name: string | null; uri: string; action: string | null };
  renderSource: null;
  componentPath: string | null;
}

// ---------------------------------------------------------------------------
// Context variable exposed via c.var.inertia
// ---------------------------------------------------------------------------

export interface InertiaContext {
  render<
    C extends PageName,
    P extends Record<string, unknown> = Record<never, never>,
  >(
    component: C,
    properties?: P,
    viewData?: Record<string, unknown>,
  ): Promise<RenderResponse<C, P>>;
  // Sets page.url for this response, e.g. the form page when a POST handler
  // renders validation errors instead of redirecting
  url(url: string): void;
  share(data: Record<string, unknown>): void;
  location(url: string): Response;
  redirect(url: string): Response;
  encryptHistory(encrypt?: boolean): void;
  clearHistory(clear?: boolean): void;
  preserveFragment(preserve?: boolean): void;
  viewData(data: Record<string, unknown>): void;
  // On the page when this request renders one, otherwise kept in the session
  // for the next page.
  flash(data: Record<string, unknown>): void;
  // Validation errors for this page when the handler renders after calling
  // it, or for the next page otherwise, which needs the `session` option
  withErrors(errors: ValidationErrors, bag?: string): void;
  // Redirects to the Referer's path, or to `fallback` without one
  back(fallback?: string): Response;
  // The client's broadcaster connection id from `X-Socket-Id`, so a broadcast
  // can skip the connection that caused it
  socketId(): string | null;
}

// ---------------------------------------------------------------------------
// Hono Env type for typed c.var.inertia
// ---------------------------------------------------------------------------

export interface InertiaEnv {
  Variables: {
    inertia: InertiaContext;
  };
}

// ---------------------------------------------------------------------------
// Scroll metadata adapter (public — users implement for their paginator)
// ---------------------------------------------------------------------------

export interface ScrollMetadata {
  getPageName(): string;
  getCurrentPage(): number;
  getPreviousPage(): number | null;
  getNextPage(): number | null;
}

// ---------------------------------------------------------------------------
// Tagged prop types (internal)
// ---------------------------------------------------------------------------

export type MergeStrategy = 'append' | 'prepend' | 'deep';

// T is the resolved value. Runtime code ignores it; ResolvedProps reads it.
export interface OptionalProperty<T = unknown> {
  __hono_inertia_prop_type__: 'optional';
  value: () => T | Promise<T>;
  isOnce: boolean;
  onceKey: string | null;
  expiresAt: number | null;
  // Set by .live()
  liveMetadata?: LivePropertyMetadata;
}

export interface AlwaysProperty<T = unknown> {
  __hono_inertia_prop_type__: 'always';
  value: T | (() => T | Promise<T>);
  // Set by .live()
  liveMetadata?: LivePropertyMetadata;
}

export interface DeferredProperty<T = unknown> {
  __hono_inertia_prop_type__: 'deferred';
  value: () => T | Promise<T>;
  group: string;
  shouldRescue: boolean;
  isMerge: boolean;
  mergeStrategy: MergeStrategy;
  matchOn: string | null;
  isOnce: boolean;
  onceKey: string | null;
  expiresAt: number | null;
  // Set by .live()
  liveMetadata?: LivePropertyMetadata;
}

export interface MergeProperty<T = unknown> {
  __hono_inertia_prop_type__: 'merge';
  value: T | (() => T | Promise<T>);
  strategy: MergeStrategy;
  matchOn: string | null;
}

export interface OnceProperty<T = unknown> {
  __hono_inertia_prop_type__: 'once';
  value: () => T | Promise<T>;
  onceKey: string | null;
  expiresAt: number | null;
  // Set by .live()
  liveMetadata?: LivePropertyMetadata;
}

export interface ScrollProperty<T = unknown> {
  __hono_inertia_prop_type__: 'scroll';
  value: T | (() => T | Promise<T>);
  pageName: string;
  currentPage: number;
  previousPage: number | null;
  nextPage: number | null;
  matchOn: string | null;
}

// A plain prop that refreshes on broadcast events
export interface LiveProperty<T = unknown> {
  __hono_inertia_prop_type__: 'live';
  value: T | (() => T | Promise<T>);
  liveMetadata: LivePropertyMetadata;
}

export type TaggedProperty =
  | LiveProperty
  | OptionalProperty
  | AlwaysProperty
  | DeferredProperty
  | MergeProperty
  | OnceProperty
  | ScrollProperty;
