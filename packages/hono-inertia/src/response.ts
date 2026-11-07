import type { Context } from 'hono';
import { routePath } from 'hono/route';
import type {
  AlwaysProperty,
  DeferredProperty,
  ResolvedInertiaConfig,
  InertiaContext,
  LivePropertyMetadata,
  MergeProperty,
  MergeSettings,
  MergeStrategy,
  OnceProperty,
  OnceSettings,
  OptionalProperty,
  PageObject,
  ScrollProperty,
  SessionData,
  SsrResult,
  TaggedProperty,
  BackOptions,
  ValidationErrors,
} from './types.js';
import { isTaggedProp } from './properties.js';
import { PROP_TYPE } from './symbols.js';
import { isSsrEnabled, renderSsr } from './ssr.js';
import { stringifyPage } from './serialize.js';
import type { DevtoolsPayload } from './devtools.js';
import type { PageName, RenderResponse } from './page-properties.js';
import {
  cacheControlValue,
  getErrorBag,
  getExceptOnceProperties,
  getPartialComponent,
  getPartialData,
  getPartialExcept,
  getResetProperties,
  getScrollMergeIntent,
  isInertiaRequest,
  toPageUrl,
} from './utilities.js';

export class InertiaResponse implements InertiaContext {
  private sharedProps: Record<string, unknown> = {};
  private viewDataStore: Record<string, unknown> = {};
  private flashStore: Record<string, unknown> = {};
  private errorStore: Record<string, ValidationErrors> = {};
  private didRender = false;
  private shouldEncryptHistory = false;
  // Set by ssr(), and wins over the config's enabled flag
  private ssrOverride: boolean | undefined;
  private shouldClearHistory = false;
  private clearHistoryWasConsumed = false;
  private shouldPreserveFragment = false;
  private preserveFragmentWasConsumed = false;
  private urlOverride: string | undefined;
  private devtoolsPayloadStore: DevtoolsPayload | null = null;

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
  // a 409, JSON) keeps it for the next page, adding what this request flashed.
  // Read by the middleware. Not part of the public InertiaContext interface.
  get sessionAfter(): SessionData | null | undefined {
    if (this.didRender) return this.incomingSession ? null : undefined;

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

  ssr(enabled = true): void {
    this.ssrOverride = enabled;
  }

  encryptHistory(encrypt = true): void {
    this.shouldEncryptHistory = encrypt;
  }

  clearHistory(clear = true): void {
    this.shouldClearHistory = clear;
  }

  // Read by the middleware to flash clearHistory across redirects via a
  // cookie. Not part of the public InertiaContext interface.
  get clearHistoryPending(): boolean {
    return this.shouldClearHistory;
  }

  get clearHistoryConsumed(): boolean {
    return this.clearHistoryWasConsumed;
  }

  // Read by the middleware's DevTools recorder after the handler ran.
  get devtoolsPayload(): DevtoolsPayload | null {
    return this.devtoolsPayloadStore;
  }

  preserveFragment(preserve = true): void {
    this.shouldPreserveFragment = preserve;
  }

  // Read by the middleware to flash preserveFragment across redirects, as
  // with clearHistory
  get preserveFragmentPending(): boolean {
    return this.shouldPreserveFragment;
  }

  get preserveFragmentConsumed(): boolean {
    return this.preserveFragmentWasConsumed;
  }

  clientRedirect(url: string): Response {
    if (isInertiaRequest(this.c)) {
      return new Response(null, {
        status: 409,
        headers: {
          'X-Inertia-Redirect': url,
          Vary: 'X-Inertia',
          ...this.cacheControlHeader(),
        },
      });
    }
    return this.c.redirect(url, 302);
  }

  location(url: string): Response {
    if (isInertiaRequest(this.c)) {
      return new Response(null, {
        status: 409,
        headers: {
          'X-Inertia-Location': url,
          Vary: 'X-Inertia',
          ...this.cacheControlHeader(),
        },
      });
    }
    return this.c.redirect(url, 302);
  }

  private cacheControlHeader(): Record<string, string> {
    const cacheControl = cacheControlValue(this.config);
    return cacheControl === undefined ? {} : { 'Cache-Control': cacheControl };
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
    const mergedViewData = { ...this.viewDataStore, ...extraViewData };
    this.didRender = true;

    // Errors and flash from the previous request, plus any this handler added
    // before rendering
    const session = mergeSessionData(this.incomingSession, {
      errors: this.errorStore,
      flash: this.flashStore,
    });
    const flash = session.flash ?? {};

    // 1. Capture shared prop keys before merging (for v3 instant visits)
    const sharedKeys = Object.keys(this.sharedProps);

    // 2. Merge shared + render props. Render props win. Ensure errors exists.
    const allProperties: Record<string, unknown> = {
      errors: resolveSessionErrors(
        session.errors,
        getErrorBag(this.c),
        (fields) => this.pageMessages(fields),
      ),
      ...this.sharedProps,
      ...properties,
    };

    const isInertia = isInertiaRequest(this.c);
    const partialComponent = getPartialComponent(this.c);
    const isPartialForThis = partialComponent === component;
    const partialData = getPartialData(this.c);
    const partialExcept = getPartialExcept(this.c);
    const isPartialRequest =
      isPartialForThis && (partialData.size > 0 || partialExcept.size > 0);
    const exceptOnceProperties = getExceptOnceProperties(this.c);
    const resetProperties = getResetProperties(this.c);
    const scrollMergeIntent = getScrollMergeIntent(this.c);

    // 3. Classify props and determine which to include
    const included: Record<string, unknown> = {};
    const deferredGroups: Record<string, string[]> = {};
    const mergeKeys: string[] = [];
    const prependKeys: string[] = [];
    const deepMergeKeys: string[] = [];
    const matchOnKeys: string[] = [];
    const rescuableKeys = new Set<string>();
    const onceMetadata: Record<
      string,
      { prop: string; expiresAt: number | null }
    > = {};
    const scrollMetadata: NonNullable<PageObject['scrollProps']> = {};

    // The props tree as dot paths. Plain objects are branches, so prop types
    // and lazy functions inside them work as at the top level, as in
    // inertia-laravel. The client deep-merges a partial response into the
    // top-level props that dot paths in only and except name.
    const { leaves, branches } = flattenProperties(allProperties);

    // A prop is requested if named, if it sits inside a named path (`auth`
    // requests `auth.user`), or if a named path sits inside it (`user.name`
    // requests a `user` that resolves to an object, which the client slices)
    const isRequestedByPartialData = (path: string): boolean => {
      if (partialData.has(path)) return true;
      for (const entry of partialData) {
        if (entry.startsWith(`${path}.`) || path.startsWith(`${entry}.`)) {
          return true;
        }
      }
      return false;
    };

    const isExcepted = (path: string): boolean => {
      if (partialExcept.has(path)) return true;
      for (const entry of partialExcept) {
        if (path.startsWith(`${entry}.`)) return true;
      }
      return false;
    };

    const isFilteredOut = (path: string): boolean => {
      if (!isPartialRequest) return false;
      if (path === 'errors') return false;
      if (partialData.size > 0 && !isRequestedByPartialData(path)) return true;
      return partialExcept.size > 0 && isExcepted(path);
    };

    // The client compares expiresAt with Date.now(), so a ttl becomes a
    // timestamp when the prop is sent
    const addOnceMetadata = (key: string, settings: OnceSettings): void => {
      onceMetadata[settings.key ?? key] = {
        prop: key,
        expiresAt: settings.ttl === null ? null : Date.now() + settings.ttl,
      };
    };

    // The client lists the once props it holds on every request. As in
    // inertia-laravel, only a full visit skips them: a partial reload that
    // names one asks for a fresh value.
    const clientHolds = (key: string, settings: OnceSettings): boolean =>
      !isPartialRequest && exceptOnceProperties.has(settings.key ?? key);

    // X-Inertia-Reset asks the client to replace the prop, so it gets no
    // merge metadata
    const addMergeMetadata = (key: string, settings: MergeSettings): void => {
      if (resetProperties.has(key)) return;
      collectMergeMetadata(key, settings, {
        mergeKeys,
        prependKeys,
        deepMergeKeys,
        matchOnKeys,
      });
    };

    const propertyHandlers: Record<
      string,
      (key: string, tagged: TaggedProperty) => void
    > = {
      live: (key, tagged) => {
        if (isFilteredOut(key)) return;
        included[key] = tagged.value;
      },

      always: (key, tagged) => {
        included[key] = (tagged as AlwaysProperty).value;
      },

      optional: (key, tagged) => {
        const opt = tagged as OptionalProperty;
        if (isPartialRequest && isRequestedByPartialData(key)) {
          included[key] = opt.value;
          if (opt.onceSettings) addOnceMetadata(key, opt.onceSettings);
        } else if (!isPartialRequest && opt.onceSettings) {
          // Left out, but listed, so the client carries over a value it holds
          addOnceMetadata(key, opt.onceSettings);
        }
      },

      deferred: (key, tagged) => {
        const deferred = tagged as DeferredProperty;
        if (isPartialForThis && isRequestedByPartialData(key)) {
          included[key] = deferred.value;
          if (deferred.shouldRescue) {
            rescuableKeys.add(key);
          }
          if (deferred.mergeSettings)
            addMergeMetadata(key, deferred.mergeSettings);
          if (deferred.onceSettings)
            addOnceMetadata(key, deferred.onceSettings);
        } else if (!isPartialRequest) {
          // A once prop the client holds isn't fetched again
          if (
            !deferred.onceSettings ||
            !clientHolds(key, deferred.onceSettings)
          ) {
            deferredGroups[deferred.group] ??= [];
            deferredGroups[deferred.group].push(key);
          }
          if (deferred.onceSettings)
            addOnceMetadata(key, deferred.onceSettings);
          if (deferred.mergeSettings)
            addMergeMetadata(key, deferred.mergeSettings);
        }
      },

      merge: (key, tagged) => {
        const m = tagged as MergeProperty;
        if (isFilteredOut(key)) return;
        included[key] = m.value;
        addMergeMetadata(key, m.mergeSettings);
      },

      once: (key, tagged) => {
        const o = tagged as OnceProperty;
        if (isFilteredOut(key)) return;
        // Left out, but listed, so the client carries over the value it holds
        addOnceMetadata(key, o.onceSettings);
        if (clientHolds(key, o.onceSettings)) return;
        included[key] = o.value;
      },

      scroll: (key, tagged) => {
        const s = tagged as ScrollProperty;
        if (isFilteredOut(key)) return;
        included[key] = s.value;
        scrollMetadata[key] = {
          pageName: s.pageName,
          currentPage: s.currentPage,
          previousPage: s.previousPage,
          nextPage: s.nextPage,
          // As in inertia-laravel, only X-Inertia-Reset naming the prop
          // resets the client's scroll state
          reset: resetProperties.has(key),
        };
        addMergeMetadata(key, {
          strategy: scrollMergeIntent,
          appendPaths: [],
          prependPaths: [],
          matchOn: s.matchOnFields,
        });
      },
    };

    for (const [path, value] of leaves) {
      if (!isTaggedProp(value)) {
        if (!isFilteredOut(path)) {
          included[path] = value;
        }
        continue;
      }

      const propertyType = value[PROP_TYPE];
      propertyHandlers[propertyType]?.(path, value);
    }

    // Live listeners go on the first visit even for props left out of it, so
    // the client knows what to subscribe to. A partial response only carries
    // the props it refreshed; the client keeps the rest.
    const liveMetadata: Record<string, LivePropertyMetadata> = {};
    for (const [key, value] of leaves) {
      if (!isTaggedProp(value) || !('liveMetadata' in value)) continue;
      if (!value.liveMetadata) continue;
      if (isPartialRequest && !(key in included)) continue;
      liveMetadata[key] = value.liveMetadata;
    }

    // 4. Resolve lazy values (functions and async functions). A rescuable
    // deferred prop that throws is sent as null and reported instead of
    // failing the whole response (mirrors Laravel's `defer(..., rescue: true)`).
    const resolved: Record<string, unknown> = {};
    // A full response keeps every branch, also one whose props all wait for
    // a partial reload
    if (!isPartialRequest) {
      for (const branch of branches) setPath(resolved, branch, {});
    }
    const rescued = new Set<string>();
    const resolvePromises: Array<Promise<void>> = [];

    for (const [key, value] of Object.entries(included)) {
      if (typeof value !== 'function') {
        setPath(resolved, key, value);
        continue;
      }
      const promise = Promise.resolve()
        .then(() => value())
        .then(
          (result) => {
            setPath(resolved, key, result);
          },
          (error: unknown) => {
            if (!rescuableKeys.has(key)) throw error;
            (this.config.onRescue ?? defaultOnRescue)(error, key);
            setPath(resolved, key, null);
            rescued.add(key);
          },
        );
      resolvePromises.push(promise);
    }

    await Promise.all(resolvePromises);
    const rescuedProperties = Object.keys(included).filter((key) =>
      rescued.has(key),
    );

    // 5. Build page object
    const page: PageObject = {
      component,
      props: resolved,
      url: toPageUrl(
        this.c,
        this.urlOverride ?? this.config.resolveUrl?.(this.c) ?? this.c.req.url,
      ),
      version: await this.version(),
    };

    if (this.shouldEncryptHistory) {
      page.encryptHistory = true;
    }
    if (this.shouldClearHistory) {
      page.clearHistory = true;
      this.clearHistoryWasConsumed = true;
    }
    if (this.shouldPreserveFragment) {
      page.preserveFragment = true;
      this.preserveFragmentWasConsumed = true;
    }
    if (sharedKeys.length > 0) {
      page.sharedProps = sharedKeys;
    }
    if (Object.keys(flash).length > 0) {
      page.flash = flash;
    }
    if (Object.keys(deferredGroups).length > 0) {
      page.deferredProps = deferredGroups;
    }
    if (mergeKeys.length > 0) {
      page.mergeProps = mergeKeys;
    }
    if (prependKeys.length > 0) {
      page.prependProps = prependKeys;
    }
    if (deepMergeKeys.length > 0) {
      page.deepMergeProps = deepMergeKeys;
    }
    if (matchOnKeys.length > 0) {
      page.matchPropsOn = matchOnKeys;
    }
    if (Object.keys(onceMetadata).length > 0) {
      page.onceProps = onceMetadata;
    }
    if (Object.keys(scrollMetadata).length > 0) {
      page.scrollProps = scrollMetadata;
    }
    if (rescuedProperties.length > 0) {
      page.rescuedProps = rescuedProperties;
    }
    if (Object.keys(liveMetadata).length > 0) {
      page.liveProps = liveMetadata;
    }

    this.devtoolsPayloadStore = {
      component,
      page,
      routePath: routePath(this.c),
      // By top-level prop, as DevTools lists them. A branch reads as plain.
      propTags: Object.fromEntries(
        Object.keys(resolved).map((key) => [
          key,
          isTaggedProp(allProperties[key]) ? allProperties[key] : undefined,
        ]),
      ),
      rescuedProps: rescuedProperties,
      sharedKeys,
    };

    // 6. Return response. Built through the Hono context so c.status() and
    // c.header() set by the handler apply to both JSON and HTML responses.
    // newResponse, not json(): the page goes through stringifyPage, not
    // JSON.stringify.
    if (isInertia) {
      return this.withDefaultCacheControl(
        this.c.newResponse(stringifyPage(page), undefined, {
          'Content-Type': 'application/json',
          'X-Inertia': 'true',
        }),
      );
    }

    // Initial visit: optionally SSR, then render HTML
    let ssrResult: SsrResult | undefined;
    const ssrConfig = this.config.ssr;
    const ssrEnabled =
      ssrConfig !== undefined &&
      (this.ssrOverride ?? (await isSsrEnabled(ssrConfig, this.c)));
    if (ssrConfig && ssrEnabled) {
      try {
        ssrResult = await renderSsr(ssrConfig, page, this.c);
      } catch (error) {
        (this.config.onSsrError ?? defaultOnSsrError)(error, page);
      }
    }

    const htmlContent = await this.config.render(
      page,
      mergedViewData,
      ssrResult,
      this.c,
    );
    // hono/html returns a String object typed as string, and for it c.html()
    // returns a Promise. Widening the type keeps the await from looking
    // unnecessary to TypeScript and ESLint.
    const htmlResponse = this.c.html(htmlContent as string | Promise<string>);
    return this.withDefaultCacheControl(await htmlResponse);
  }

  // Only when absent: a Cache-Control set by the handler (via c.header) wins.
  private withDefaultCacheControl(response: Response): Response {
    const cacheControl = cacheControlValue(this.config);
    if (cacheControl !== undefined && !response.headers.has('Cache-Control')) {
      response.headers.set('Cache-Control', cacheControl);
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

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || isTaggedProp(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

interface FlattenedProperties {
  // [dot path, value] for every prop that is not a branch
  leaves: Array<[string, unknown]>;
  // Dot paths of the plain objects in between, parents first
  branches: string[];
}

// errors stays one prop: its keys are field names, not props. An empty
// object, and one with toJSON(), are values, not branches.
function flattenProperties(
  properties: Record<string, unknown>,
  prefix = '',
  result: FlattenedProperties = { leaves: [], branches: [] },
): FlattenedProperties {
  for (const [key, value] of Object.entries(properties)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (
      path !== 'errors' &&
      isPlainObject(value) &&
      typeof value.toJSON !== 'function' &&
      Object.keys(value).length > 0
    ) {
      result.branches.push(path);
      flattenProperties(value, path, result);
    } else {
      result.leaves.push([path, value]);
    }
  }
  return result;
}

// Sets a dot path in a props object, creating the objects on the way
function setPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const keys = path.split('.');
  const last = keys.pop() ?? path;
  let current = target;
  for (const key of keys) {
    const next = current[key];
    if (isPlainObject(next)) {
      current = next;
    } else {
      const created: Record<string, unknown> = {};
      current[key] = created;
      current = created;
    }
  }
  current[last] = value;
}

interface MergeMetadataTargets {
  mergeKeys: string[];
  prependKeys: string[];
  deepMergeKeys: string[];
  matchOnKeys: string[];
}

// Follows inertia-laravel: a deep merge or a root merge lists the prop, and
// merges at paths list `key.path` instead
function collectMergeMetadata(
  key: string,
  settings: MergeSettings,
  targets: MergeMetadataTargets,
): void {
  const atRoot =
    settings.appendPaths.length === 0 && settings.prependPaths.length === 0;
  const rootTargets: Record<MergeStrategy, string[]> = {
    append: targets.mergeKeys,
    prepend: targets.prependKeys,
    deep: targets.deepMergeKeys,
  };
  if (settings.strategy === 'deep' || atRoot) {
    rootTargets[settings.strategy].push(key);
  } else {
    for (const path of settings.appendPaths) {
      targets.mergeKeys.push(`${key}.${path}`);
    }
    for (const path of settings.prependPaths) {
      targets.prependKeys.push(`${key}.${path}`);
    }
  }
  for (const field of settings.matchOn) {
    targets.matchOnKeys.push(`${key}.${field}`);
  }
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
