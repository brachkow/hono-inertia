import type { Context } from 'hono';
import { routePath } from 'hono/route';
import type {
  AlwaysProperty,
  DeferredProperty,
  InertiaConfig,
  InertiaContext,
  MergeProperty,
  MergeStrategy,
  OnceProperty,
  OptionalProperty,
  PageObject,
  ScrollProperty,
  SsrResult,
  TaggedProperty,
} from './types.js';
import { isTaggedProp } from './properties.js';
import { renderSsr } from './ssr.js';
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
  hasScrollMergeIntent,
  isInertiaRequest,
  toPageUrl,
} from './utilities.js';

export class InertiaResponse implements InertiaContext {
  private sharedProps: Record<string, unknown> = {};
  private viewDataStore: Record<string, unknown> = {};
  private flashStore: Record<string, unknown> = {};
  private shouldEncryptHistory = false;
  private shouldClearHistory = false;
  private clearHistoryWasConsumed = false;
  private shouldPreserveFragment = false;
  private urlOverride: string | undefined;
  private devtoolsPayloadStore: DevtoolsPayload | null = null;

  constructor(
    private c: Context,
    private config: InertiaConfig,
    private version: () => Promise<string | null>,
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

  redirect(url: string): Response {
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

  private async renderPage(
    component: string,
    properties: Record<string, unknown>,
    extraViewData: Record<string, unknown>,
  ): Promise<Response> {
    const mergedViewData = { ...this.viewDataStore, ...extraViewData };

    // 1. Capture shared prop keys before merging (for v3 instant visits)
    const sharedKeys = Object.keys(this.sharedProps);

    // 2. Merge shared + render props. Render props win. Ensure errors exists.
    const allProperties: Record<string, unknown> = {
      errors: {},
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
    const errorBag = getErrorBag(this.c);
    const resetProperties = getResetProperties(this.c);
    const scrollMergeIntent = getScrollMergeIntent(this.c);
    // No merge-intent header => a fresh load, so the client should reset the
    // accumulated infinite-scroll collection rather than append/prepend.
    const scrollReset = !hasScrollMergeIntent(this.c);

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
    const scrollMetadata: Record<
      string,
      {
        pageName: string;
        previousPage: number | null;
        nextPage: number | null;
        currentPage: number;
        reset: boolean;
      }
    > = {};

    // A top-level prop is requested if named directly or via a nested path
    // (e.g. `only: ['user.name']` requests the `user` prop). The client extracts
    // the nested slice; the server only resolves whole top-level props.
    const isRequestedByPartialData = (key: string): boolean => {
      if (partialData.has(key)) return true;
      for (const entry of partialData) {
        if (entry.startsWith(`${key}.`)) return true;
      }
      return false;
    };

    const isFilteredOut = (key: string): boolean => {
      if (!isPartialRequest) return false;
      if (key === 'errors') return false;
      if (partialData.size > 0 && !isRequestedByPartialData(key)) return true;
      if (partialExcept.size > 0 && partialExcept.has(key)) return true;
      return false;
    };

    const propertyHandlers: Record<
      string,
      (key: string, tagged: TaggedProperty) => void
    > = {
      always: (key, tagged) => {
        included[key] = (tagged as AlwaysProperty).value;
      },

      optional: (key, tagged) => {
        const opt = tagged as OptionalProperty;
        if (isPartialRequest && isRequestedByPartialData(key)) {
          if (opt.isOnce && exceptOnceProperties.has(opt.onceKey ?? key))
            return;
          included[key] = opt.value;
          if (opt.isOnce) {
            onceMetadata[opt.onceKey ?? key] = {
              prop: key,
              expiresAt: opt.expiresAt,
            };
          }
        }
      },

      deferred: (key, tagged) => {
        const deferred = tagged as DeferredProperty;
        if (isPartialForThis && isRequestedByPartialData(key)) {
          if (
            deferred.isOnce &&
            exceptOnceProperties.has(deferred.onceKey ?? key)
          )
            return;
          included[key] = deferred.value;
          if (deferred.shouldRescue) {
            rescuableKeys.add(key);
          }
          if (deferred.isMerge && !resetProperties.has(key)) {
            collectMergeMetadata(
              key,
              deferred.mergeStrategy,
              deferred.matchOn,
              mergeKeys,
              prependKeys,
              deepMergeKeys,
              matchOnKeys,
            );
          }
          if (deferred.isOnce) {
            onceMetadata[deferred.onceKey ?? key] = {
              prop: key,
              expiresAt: deferred.expiresAt,
            };
          }
        } else if (!isPartialRequest) {
          if (!deferredGroups[deferred.group]) {
            deferredGroups[deferred.group] = [];
          }
          deferredGroups[deferred.group].push(key);
          if (deferred.isMerge) {
            collectMergeMetadata(
              key,
              deferred.mergeStrategy,
              deferred.matchOn,
              mergeKeys,
              prependKeys,
              deepMergeKeys,
              matchOnKeys,
            );
          }
        }
      },

      merge: (key, tagged) => {
        const m = tagged as MergeProperty;
        if (isFilteredOut(key)) return;
        included[key] = m.value;
        if (!resetProperties.has(key)) {
          collectMergeMetadata(
            key,
            m.strategy,
            m.matchOn,
            mergeKeys,
            prependKeys,
            deepMergeKeys,
            matchOnKeys,
          );
        }
      },

      once: (key, tagged) => {
        const o = tagged as OnceProperty;
        if (exceptOnceProperties.has(o.onceKey ?? key)) return;
        if (isFilteredOut(key)) return;
        included[key] = o.value;
        onceMetadata[o.onceKey ?? key] = {
          prop: key,
          expiresAt: o.expiresAt,
        };
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
          reset: scrollReset,
        };
        if (!resetProperties.has(key)) {
          collectMergeMetadata(
            key,
            scrollMergeIntent === 'prepend' ? 'prepend' : 'append',
            s.matchOn,
            mergeKeys,
            prependKeys,
            deepMergeKeys,
            matchOnKeys,
          );
        }
      },
    };

    for (const [key, value] of Object.entries(allProperties)) {
      if (!isTaggedProp(value)) {
        if (!isFilteredOut(key)) {
          included[key] = value;
        }
        continue;
      }

      const propertyType = value.__hono_inertia_prop_type__;
      propertyHandlers[propertyType]?.(key, value);
    }

    // 4. Resolve lazy values (functions and async functions). A rescuable
    // deferred prop that throws is sent as null and reported instead of
    // failing the whole response (mirrors Laravel's `defer(..., rescue: true)`).
    const resolved: Record<string, unknown> = {};
    const rescued = new Set<string>();
    const resolvePromises: Array<Promise<void>> = [];

    for (const [key, value] of Object.entries(included)) {
      if (typeof value !== 'function') {
        resolved[key] = value;
        continue;
      }
      const promise = Promise.resolve()
        .then(() => value())
        .then(
          (result) => {
            resolved[key] = result;
          },
          (error: unknown) => {
            if (!rescuableKeys.has(key)) throw error;
            (this.config.onRescue ?? defaultOnRescue)(error, key);
            resolved[key] = null;
            rescued.add(key);
          },
        );
      resolvePromises.push(promise);
    }

    await Promise.all(resolvePromises);
    const rescuedProperties = Object.keys(included).filter((key) =>
      rescued.has(key),
    );

    // 5. Handle error bag scoping
    if (errorBag && resolved.errors && typeof resolved.errors === 'object') {
      const errors = resolved.errors as Record<string, unknown>;
      resolved.errors = errors[errorBag] ?? {};
    }

    // 6. Build page object
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
    }
    if (sharedKeys.length > 0) {
      page.sharedProps = sharedKeys;
    }
    if (Object.keys(this.flashStore).length > 0) {
      page.flash = this.flashStore;
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

    this.devtoolsPayloadStore = {
      component,
      page,
      routePath: routePath(this.c),
      propTags: Object.fromEntries(
        Object.keys(included).map((key) => [
          key,
          isTaggedProp(allProperties[key]) ? allProperties[key] : undefined,
        ]),
      ),
      rescuedProps: rescuedProperties,
      sharedKeys,
    };

    // 7. Return response. Built through the Hono context so c.status() and
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
    if (this.config.ssr && this.config.ssr.enabled !== false) {
      try {
        ssrResult = await renderSsr(this.config.ssr, page);
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

function collectMergeMetadata(
  key: string,
  strategy: MergeStrategy,
  matchOn: string | null,
  mergeKeys: string[],
  prependKeys: string[],
  deepMergeKeys: string[],
  matchOnKeys: string[],
): void {
  const strategyCollectors: Record<MergeStrategy, () => void> = {
    append: () => mergeKeys.push(key),
    prepend: () => prependKeys.push(key),
    deep: () => deepMergeKeys.push(key),
  };
  strategyCollectors[strategy]();
  if (matchOn) {
    matchOnKeys.push(`${key}.${matchOn}`);
  }
}
