import type { Context } from 'hono';
import type { PageName, RenderResponse } from './page-properties.js';
import type { PROP_TYPE } from './symbols.js';
import type { CookieSessionOptions } from './session.js';

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
      previousPage: ScrollPage | null;
      nextPage: ScrollPage | null;
      currentPage: ScrollPage;
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

// Turns SSR off for some requests, e.g. (c) => !c.req.path.startsWith('/admin')
export type SsrEnabled = boolean | ((c: Context) => boolean | Promise<boolean>);

// Posts the page to `${url}/render` on an Inertia SSR server (`createServer`)
export interface SsrHttpConfig {
  enabled?: SsrEnabled;
  url?: string;
  // Sends the request instead of the global fetch, e.g. through a Cloudflare
  // service binding: (request, c) => c.env.SSR.fetch(request)
  fetch?: (request: Request, c: Context) => Response | Promise<Response>;
  // Abort the SSR request after this many ms (default 5000), falling back to CSR.
  timeout?: number;
  // Reject SSR responses larger than this many bytes (default 2_000_000).
  maxResponseBytes?: number;
  render?: never;
}

// Renders in the same process, e.g. a Worker that imports the SSR entry
export interface SsrRenderConfig {
  enabled?: SsrEnabled;
  render: (page: PageObject) => SsrRenderResult | Promise<SsrRenderResult>;
  url?: never;
  fetch?: never;
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

// The parts of honoInertia()'s virtual module that inertia() reads. Pass the
// module itself: `import * as assets from 'virtual:hono-inertia/assets'`.
export interface InertiaAssets {
  version: string;
  assetTagsFor: (component: string) => string;
  // The plugin's `ssr` entry, when it has one
  ssr?: ((page: PageObject) => Promise<SsrRenderResult>) | null;
}

// The root template inertia() renders when there is no `render` option
export interface TemplateOptions {
  // <html lang>
  lang?: string;
  // A <title> for pages whose SSR output has none
  title?: string;
  // More HTML for <head>, such as a favicon or fonts
  head?: string | ((page: PageObject, c: Context) => string | Promise<string>);
  // The root element's id, which createInertiaApp() reads. Defaults to 'app'.
  id?: string;
}

// ---------------------------------------------------------------------------
// Middleware configuration
// ---------------------------------------------------------------------------

// V is what share() returns. PageProps adds it to every page's props.
export interface InertiaConfig<
  V extends Record<string, unknown> = Record<string, unknown>,
> {
  // Asset version. Omitting it disables version checks (page.version: null).
  // Keep the value short — the client echoes it back as a request header.
  // Defaults to assets.version.
  version?: string | (() => string | Promise<string>);
  // The Vite plugin's virtual module. Gives the version, the asset tags of
  // the default template, and the SSR render function.
  assets?: InertiaAssets;
  // Options for the default template
  template?: TemplateOptions;
  // Renders the HTML of a first visit. Replaces the default template.
  render?: RenderFunction;
  // Defaults to rendering with assets.ssr when the plugin has an SSR entry
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
  // enable in development only. See brachkow.github.io/hono-inertia/guide/devtools.
  devtools?: boolean | DevtoolsConfig;
  // Carries validation errors and flash data across redirects. Without it,
  // flash() applies to the current response only, and withErrors() works only
  // when the handler renders a page afterwards.
  // Pass a store, or cookieSession()'s options for the built-in signed
  // cookie. See brachkow.github.io/hono-inertia/guide/sessions.
  session?: InertiaSession | CookieSessionOptions;
  // Pages get every message per field from withErrors() and the validator,
  // as arrays. By default they get the first one, as with Laravel's adapter.
  allErrors?: boolean;
  // Maps the name render() takes to the component name the client resolves,
  // e.g. (name) => name.toLowerCase()
  transformComponent?: (component: string) => string;
  // The short-lived cookies that carry clearHistory() and preserveFragment()
  // across redirects. Defaults to the prefix 'inertia_' and the path '/'.
  flagCookies?: { prefix?: string; path?: string };
}

// The config after inertia() filled in its defaults
export type ResolvedInertiaConfig<
  V extends Record<string, unknown> = Record<string, unknown>,
> = Omit<InertiaConfig<V>, 'render' | 'session' | 'assets' | 'template'> & {
  render: RenderFunction;
  session?: InertiaSession;
};

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
  // A 409 with X-Inertia-Redirect: the client visits the URL itself. Unlike
  // Hono's c.redirect(), the browser never follows it, so it keeps a fragment.
  clientRedirect(url: string): Response;
  encryptHistory(encrypt?: boolean): void;
  clearHistory(clear?: boolean): void;
  preserveFragment(preserve?: boolean): void;
  // Renders this response's first visit without SSR, or with it again
  ssr(enabled?: boolean): void;
  viewData(data: Record<string, unknown>): void;
  // On the page when this request renders one, otherwise kept in the session
  // for the next page.
  flash(data: Record<string, unknown>): void;
  // Validation errors for this page when the handler renders after calling
  // it, or for the next page otherwise, which needs the `session` option
  withErrors(errors: ValidationErrors, bag?: string): void;
  // Redirects to the Referer's path, or to the fallback without one. A string
  // is the fallback.
  back(options?: string | BackOptions): Response;
  // The client's broadcaster connection id from `X-Socket-Id`, so a broadcast
  // can skip the connection that caused it
  socketId(): string | null;
}

export interface BackOptions {
  // Where to go without a usable Referer. Defaults to '/'.
  fallback?: string;
  // Defaults to 302, as in Laravel. After PUT, PATCH, DELETE and QUERY the
  // middleware turns a 302 into a 303 either way.
  status?: 301 | 302 | 303 | 307 | 308;
  // Query parameters to drop from the Referer, e.g. ['modal'], or true for
  // all of them
  removeQuery?: string[] | true;
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
// Scroll and once options (public)
// ---------------------------------------------------------------------------

// A page number, or a cursor for cursor pagination
export type ScrollPage = number | string;

// The pagination of a scroll prop. With a numeric page, the previous page is
// page - 1 above page 1, and the next page is page + 1 while `hasMore` is
// true or `page` is below `lastPage`. Cursors pass previousPage and nextPage.
export interface ScrollOptions {
  page: ScrollPage;
  // The query parameter the client sends the page in. Defaults to 'page'.
  pageName?: string;
  hasMore?: boolean;
  lastPage?: number;
  previousPage?: ScrollPage | null;
  nextPage?: ScrollPage | null;
}

export interface OnceOptions {
  // Shares the cached value between props or pages with the same key
  key?: string;
  // The client asks for the prop again this many ms after it was sent
  ttl?: number;
}

// ---------------------------------------------------------------------------
// Tagged prop types (internal)
// ---------------------------------------------------------------------------

export type MergeStrategy = 'append' | 'prepend' | 'deep';

// How the client merges a prop: at the root with `strategy`, or at the paths
// inside it. matchOn holds fields relative to the prop, e.g. 'id' or 'data.id'.
export interface MergeSettings {
  strategy: MergeStrategy;
  appendPaths: string[];
  prependPaths: string[];
  matchOn: string[];
}

export interface OnceSettings {
  key: string | null;
  ttl: number | null;
}

// T is the resolved value. Runtime code ignores it; ResolvedProps reads it.
// Data fields are named apart from the chain methods (onceSettings next to
// once()), because Object.assign puts the methods on the same object.
export interface OptionalProperty<T = unknown> {
  [PROP_TYPE]: 'optional';
  value: () => T | Promise<T>;
  onceSettings: OnceSettings | null;
  // Set by .live()
  liveMetadata?: LivePropertyMetadata;
}

export interface AlwaysProperty<T = unknown> {
  [PROP_TYPE]: 'always';
  value: T | (() => T | Promise<T>);
  // Set by .live()
  liveMetadata?: LivePropertyMetadata;
}

export interface DeferredProperty<T = unknown> {
  [PROP_TYPE]: 'deferred';
  value: () => T | Promise<T>;
  group: string;
  shouldRescue: boolean;
  mergeSettings: MergeSettings | null;
  onceSettings: OnceSettings | null;
  // Set by .live()
  liveMetadata?: LivePropertyMetadata;
}

export interface MergeProperty<T = unknown> {
  [PROP_TYPE]: 'merge';
  value: T | (() => T | Promise<T>);
  mergeSettings: MergeSettings;
}

export interface OnceProperty<T = unknown> {
  [PROP_TYPE]: 'once';
  value: () => T | Promise<T>;
  onceSettings: OnceSettings;
  // Set by .live()
  liveMetadata?: LivePropertyMetadata;
}

export interface ScrollProperty<T = unknown> {
  [PROP_TYPE]: 'scroll';
  value: T | (() => T | Promise<T>);
  pageName: string;
  currentPage: ScrollPage;
  previousPage: ScrollPage | null;
  nextPage: ScrollPage | null;
  matchOnFields: string[];
}

// A plain prop that refreshes on broadcast events
export interface LiveProperty<T = unknown> {
  [PROP_TYPE]: 'live';
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
