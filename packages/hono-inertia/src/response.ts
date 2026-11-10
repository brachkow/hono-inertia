import type { Context } from 'hono';
import { routePath } from 'hono/route';
import type {
  BackOptions,
  InertiaContext,
  PageObject,
  ResolvedInertiaConfig,
  SessionData,
  SsrResult,
  ValidationErrors,
} from './types.js';
import { isSsrEnabled, renderSsr } from './ssr.js';
import { stringifyPage } from './serialize.js';
import type { DevtoolsPayload } from './devtools.js';
import type { PageName, RenderResponse } from './page-properties.js';
import {
  classifyProperties,
  flattenProperties,
  readPartialRequest,
  resolveIncluded,
} from './resolve.js';
import {
  cacheControlHeaders,
  conflictResponse,
  getErrorBag,
  isInertiaRequest,
  toPageUrl,
} from './utilities.js';

export type PageFlag = 'clearHistory' | 'preserveFragment';

// Only the fields that are set, so the page object stays as small as the
// protocol allows
const definedFields = (fields: Partial<PageObject>): Partial<PageObject> =>
  Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );

// undefined for an empty list or record, which the page leaves out
const nonEmpty = <T extends object>(value: T): T | undefined =>
  Object.keys(value).length > 0 ? value : undefined;

export class InertiaResponse implements InertiaContext {
  private sharedProps: Record<string, unknown> = {};
  private viewDataStore: Record<string, unknown> = {};
  private flashStore: Record<string, unknown> = {};
  private errorStore: Record<string, ValidationErrors> = {};
  private shouldEncryptHistory = false;
  private flags: Record<PageFlag, boolean> = {
    clearHistory: false,
    preserveFragment: false,
  };
  // Set by ssr(), and wins over the config's enabled flag
  private ssrOverride: boolean | undefined;
  private urlOverride: string | undefined;
  // What render() built, once it has
  private rendered: DevtoolsPayload | undefined;

  constructor(
    private c: Context,
    private config: ResolvedInertiaConfig,
    private version: () => Promise<string | null>,
    // What the previous request left in the session (null without one)
    private incomingSession: SessionData | null = null,
  ) {}

  share(data: Record<string, unknown>): void {
    Object.assign(this.sharedProps, data);
  }

  viewData(data: Record<string, unknown>): void {
    Object.assign(this.viewDataStore, data);
  }

  flash(data: Record<string, unknown>): void {
    Object.assign(this.flashStore, data);
  }

  withErrors(errors: ValidationErrors, bag = 'default'): void {
    this.errorStore[bag] = { ...this.errorStore[bag], ...errors };
  }

  back(options: string | BackOptions = {}): Response {
    const { status = 302, ...rest } =
      typeof options === 'string' ? { fallback: options } : options;
    return this.c.redirect(this.backUrl(rest), status);
  }

  // Only the Referer's path, query and hash, so the redirect stays on this
  // origin. Comparing origins instead would reject every Referer behind a
  // proxy, where the request's own origin is an internal one. Also used by the
  // middleware for empty 200 responses.
  backUrl({
    fallback = '/',
    removeQuery,
  }: Omit<BackOptions, 'status'> = {}): string {
    const referer = this.c.req.header('Referer');
    if (!referer) return fallback;
    let url: URL;
    try {
      url = new URL(referer, this.c.req.url);
    } catch {
      return fallback;
    }
    // Other schemes keep backslashes in the path, which browsers read as
    // slashes, so only a page's own http(s) URL counts
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback;
    if (removeQuery === true) {
      url.search = '';
    } else {
      for (const name of removeQuery ?? []) url.searchParams.delete(name);
    }
    return toPageUrl(this.c, url.href);
  }

  socketId(): string | null {
    return this.c.req.header('X-Socket-Id') ?? null;
  }

  // What the session should hold after this request, or undefined to leave it
  // alone. A rendered page used the incoming data. Anything else (a redirect,
  // a 409, JSON, a render that threw) keeps it for the next page, adding what
  // this request flashed. Read by the middleware. Not part of the public
  // InertiaContext interface.
  get sessionAfter(): SessionData | null | undefined {
    if (this.rendered) return this.incomingSession ? null : undefined;

    const hasErrors = Object.keys(this.errorStore).length > 0;
    const hasFlash = Object.keys(this.flashStore).length > 0;
    if (!hasErrors && !hasFlash) return undefined;

    // Only the messages pages show, so the data stays small enough for a
    // cookie
    const errors = Object.fromEntries(
      Object.entries(this.errorStore).map(([bag, fields]) => [
        bag,
        this.pageMessages(fields),
      ]),
    );
    return mergeSessionData(this.incomingSession, {
      ...(hasErrors && { errors }),
      ...(hasFlash && { flash: this.flashStore }),
    });
  }

  // Read by the middleware, which carries a pending flag that no rendered
  // page took to the next one. Not part of the public InertiaContext interface.
  flagState(flag: PageFlag): { pending: boolean; rendered: boolean } {
    return {
      pending: this.flags[flag],
      rendered: this.rendered?.page[flag] === true,
    };
  }

  // Read by the middleware's DevTools recorder after the handler ran
  get devtoolsPayload(): DevtoolsPayload | null {
    return this.rendered ?? null;
  }

  ssr(enabled = true): void {
    this.ssrOverride = enabled;
  }

  encryptHistory(encrypt = true): void {
    this.shouldEncryptHistory = encrypt;
  }

  clearHistory(clear = true): void {
    this.flags.clearHistory = clear;
  }

  preserveFragment(preserve = true): void {
    this.flags.preserveFragment = preserve;
  }

  clientRedirect(url: string): Response {
    return this.visitResponse('X-Inertia-Redirect', url);
  }

  location(url: string): Response {
    return this.visitResponse('X-Inertia-Location', url);
  }

  // A 409 that makes the Inertia client visit the URL itself, or a plain
  // redirect for a browser request
  private visitResponse(header: string, url: string): Response {
    return isInertiaRequest(this.c)
      ? conflictResponse(this.config, { [header]: url })
      : this.c.redirect(url, 302);
  }

  async render<
    C extends PageName,
    P extends Record<string, unknown> = Record<never, never>,
  >(
    component: C,
    properties?: P,
    extraViewData: Record<string, unknown> = {},
  ): Promise<RenderResponse<C, P>> {
    // The props in the return type exist only for PageProps to read
    return (await this.renderPage(
      component,
      properties ?? {},
      extraViewData,
    )) as RenderResponse<C, P>;
  }

  url(url: string): void {
    this.urlOverride = url;
  }

  // The first message per field, or every message with allErrors
  private pageMessages(
    fields: ValidationErrors,
  ): Record<string, string | string[]> {
    return this.config.allErrors ? allMessages(fields) : firstMessages(fields);
  }

  private async renderPage(
    name: string,
    properties: Record<string, unknown>,
    extraViewData: Record<string, unknown>,
  ): Promise<Response> {
    // The client sends this name back in X-Inertia-Partial-Component
    const component = this.config.transformComponent?.(name) ?? name;
    const viewData = { ...this.viewDataStore, ...extraViewData };

    // Errors and flash from the previous request, plus any this handler added
    // before rendering
    const session = mergeSessionData(this.incomingSession, {
      errors: this.errorStore,
      flash: this.flashStore,
    });
    // Render props win over shared ones, and errors always exists
    const allProperties: Record<string, unknown> = {
      errors: resolveSessionErrors(
        session.errors,
        getErrorBag(this.c),
        (fields) => this.pageMessages(fields),
      ),
      ...this.sharedProps,
      ...properties,
    };

    const request = readPartialRequest(this.c, component);
    const { leaves, branches } = flattenProperties(allProperties);
    const classified = classifyProperties(leaves, request);
    const { props, rescued } = await resolveIncluded(classified.included, {
      // A full response keeps every branch, also one whose props all wait
      // for a partial reload
      branches: request.isPartial ? [] : branches,
      rescuable: classified.rescuable,
      onRescue: this.config.onRescue ?? defaultOnRescue,
    });

    const page: PageObject = {
      component,
      props,
      url: toPageUrl(
        this.c,
        this.urlOverride ?? this.config.resolveUrl?.(this.c) ?? this.c.req.url,
      ),
      version: await this.version(),
      ...definedFields({
        encryptHistory: this.shouldEncryptHistory || undefined,
        clearHistory: this.flags.clearHistory || undefined,
        preserveFragment: this.flags.preserveFragment || undefined,
        // For v3 instant visits
        sharedProps: nonEmpty(Object.keys(this.sharedProps)),
        flash: nonEmpty(session.flash ?? {}),
        deferredProps: nonEmpty(classified.deferredProps),
        mergeProps: nonEmpty(classified.mergeProps),
        prependProps: nonEmpty(classified.prependProps),
        deepMergeProps: nonEmpty(classified.deepMergeProps),
        matchPropsOn: nonEmpty(classified.matchPropsOn),
        onceProps: nonEmpty(classified.onceProps),
        scrollProps: nonEmpty(classified.scrollProps),
        rescuedProps: nonEmpty(rescued),
        liveProps: nonEmpty(classified.liveProps),
      }),
    };

    this.rendered = {
      page,
      // Read inside the handler: Hono 5 restores routeIndex once next()
      // returns, so the middleware would otherwise see its own path
      routePath: routePath(this.c),
      properties: allProperties,
    };
    return this.respond(page, viewData);
  }

  // Built through the Hono context so c.status() and c.header() set by the
  // handler apply to both JSON and HTML responses
  private async respond(
    page: PageObject,
    viewData: Record<string, unknown>,
  ): Promise<Response> {
    if (isInertiaRequest(this.c)) {
      // newResponse, not json(): the page goes through stringifyPage, not
      // JSON.stringify
      return this.withDefaultCacheControl(
        this.c.newResponse(stringifyPage(page), undefined, {
          'Content-Type': 'application/json',
          'X-Inertia': 'true',
        }),
      );
    }

    // A first visit: SSR when enabled, then the HTML page
    let ssrResult: SsrResult | undefined;
    const ssrConfig = this.config.ssr;
    if (
      ssrConfig &&
      (this.ssrOverride ?? (await isSsrEnabled(ssrConfig, this.c)))
    ) {
      try {
        ssrResult = await renderSsr(ssrConfig, page, this.c);
      } catch (error) {
        (this.config.onSsrError ?? defaultOnSsrError)(error, page);
      }
    }

    const htmlContent = await this.config.render(
      page,
      viewData,
      ssrResult,
      this.c,
    );
    // hono/html returns a String object typed as string, and for it c.html()
    // returns a Promise. Widening the type keeps the await from looking
    // unnecessary to TypeScript and ESLint.
    const htmlResponse = this.c.html(htmlContent as string | Promise<string>);
    return this.withDefaultCacheControl(await htmlResponse);
  }

  // Only when absent: a Cache-Control set by the handler (via c.header) wins
  private withDefaultCacheControl(response: Response): Response {
    for (const [name, value] of Object.entries(
      cacheControlHeaders(this.config),
    )) {
      if (!response.headers.has(name)) response.headers.set(name, value);
    }
    return response;
  }
}

function defaultOnRescue(error: unknown, property: string): void {
  console.error(`[hono-inertia] rescued deferred prop "${property}"`, error);
}

function defaultOnSsrError(error: unknown, page: PageObject): void {
  console.error(
    `[hono-inertia] SSR failed for "${page.component}", rendering client-side`,
    error,
  );
}

function mergeSessionData(
  base: SessionData | null,
  added: SessionData,
): SessionData {
  const errors: Record<string, ValidationErrors> = { ...base?.errors };
  for (const [bag, fields] of Object.entries(added.errors ?? {})) {
    errors[bag] = { ...errors[bag], ...fields };
  }
  const flash = { ...base?.flash, ...added.flash };
  return {
    ...(Object.keys(errors).length > 0 && { errors }),
    ...(Object.keys(flash).length > 0 && { flash }),
  };
}

// Laravel's rules, which the client's error bag handling expects: the default
// bag goes under the name the request asked for with X-Inertia-Error-Bag, or
// unwrapped without the header. Named bags show under their own names only
// when there is no default bag. Pages get each field's first message.
function resolveSessionErrors(
  bags: Record<string, ValidationErrors> | undefined,
  errorBag: string | null,
  messages: (fields: ValidationErrors) => Record<string, string | string[]>,
): Record<string, unknown> {
  if (!bags) return {};
  if (bags.default) {
    const defaultBag = messages(bags.default);
    return errorBag ? { [errorBag]: defaultBag } : defaultBag;
  }
  return Object.fromEntries(
    Object.entries(bags).map(([bag, fields]) => [bag, messages(fields)]),
  );
}

function allMessages(fields: ValidationErrors): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(fields).map(([field, messages]) => [
      field,
      Array.isArray(messages) ? messages : [messages],
    ]),
  );
}

function firstMessages(fields: ValidationErrors): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields).map(([field, messages]) => [
      field,
      Array.isArray(messages) ? (messages[0] ?? '') : messages,
    ]),
  );
}
