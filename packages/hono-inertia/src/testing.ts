import type { PageObject } from './types.js';

// Anything with Hono's app.request(), so tests need not import a Hono version
export interface RequestableApp {
  request(input: string, init?: RequestInit): Response | Promise<Response>;
}

export interface InertiaRequestOptions {
  // Defaults to GET
  method?: string;
  // false sends a plain browser request, which gets the HTML page
  inertia?: boolean;
  // Sent as X-Inertia-Version. Omitted by default, so no version 409.
  version?: string;
  // A partial reload of `component`, as router.reload({ only, except }) sends
  partial?: { component: string; only?: string[]; except?: string[] };
  reset?: string[];
  errorBag?: string;
  // Once props the client already holds
  exceptOnceProps?: string[];
  // Sent as the JSON body with Content-Type: application/json
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
}

const list = (values: string[] | undefined): string | undefined =>
  values && values.length > 0 ? values.join(',') : undefined;

// The headers the Inertia client sends for a visit with these options
export const inertiaHeaders = (
  options: InertiaRequestOptions = {},
): Record<string, string> => {
  const entries: Array<[string, string | undefined]> = [
    ['X-Inertia', options.inertia === false ? undefined : 'true'],
    ['X-Inertia-Version', options.version],
    ['X-Inertia-Partial-Component', options.partial?.component],
    ['X-Inertia-Partial-Data', list(options.partial?.only)],
    ['X-Inertia-Partial-Except', list(options.partial?.except)],
    ['X-Inertia-Reset', list(options.reset)],
    ['X-Inertia-Error-Bag', options.errorBag],
    ['X-Inertia-Except-Once-Props', list(options.exceptOnceProps)],
    [
      'Content-Type',
      options.json === undefined ? undefined : 'application/json',
    ],
  ];
  // A header passed in options wins, whatever its case: Fetch would join two
  // spellings of one name into one value
  const overridden = new Set(
    Object.keys(options.headers ?? {}).map((name) => name.toLowerCase()),
  );
  const headers: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (value !== undefined && !overridden.has(name.toLowerCase())) {
      headers[name] = value;
    }
  }
  return { ...headers, ...options.headers };
};

// Sends a request to the app the way the Inertia client would
export const inertiaRequest = async (
  app: RequestableApp,
  path: string,
  options: InertiaRequestOptions = {},
): Promise<Response> => {
  return app.request(path, {
    method: options.method,
    headers: inertiaHeaders(options),
    body:
      options.json === undefined ? options.body : JSON.stringify(options.json),
  });
};

const DATA_PAGE_SCRIPT =
  /<script\b[^>]*\bdata-page="[^"]*"[^>]*>([\S\s]*?)<\/script>/;

// The page object from an Inertia JSON response or from the HTML of a first
// visit. Throws when the response holds neither.
export const getPage = async <Properties = Record<string, unknown>>(
  response: Response,
): Promise<PageObject & { props: Properties }> => {
  const text = await response.text();
  if (response.headers.get('X-Inertia') === 'true') {
    return JSON.parse(text) as PageObject & { props: Properties };
  }

  const match = DATA_PAGE_SCRIPT.exec(text);
  if (!match) {
    throw new Error(
      `[hono-inertia] response ${response.status} is not an Inertia page: no X-Inertia header and no data-page script`,
    );
  }
  // serializePage escapes < and > as JSON unicode escapes, so the script
  // content parses as plain JSON
  return JSON.parse(match[1]) as PageObject & { props: Properties };
};

export interface ReloadOptions {
  only?: string[];
  except?: string[];
  reset?: string[];
  headers?: Record<string, string>;
}

// A partial reload of a page, as router.reload() sends it: the page's own
// URL, component and version
export const reload = async <Properties = Record<string, unknown>>(
  app: RequestableApp,
  page: PageObject,
  options: ReloadOptions = {},
): Promise<PageObject & { props: Properties }> =>
  getPage<Properties>(
    await inertiaRequest(app, page.url, {
      version: page.version ?? undefined,
      partial: {
        component: page.component,
        only: options.only,
        except: options.except,
      },
      reset: options.reset,
      headers: options.headers,
    }),
  );

// Loads a page's deferred props the way the client does once it renders: a
// partial reload per group, here all or the ones named. Returns the page
// with their values merged into its props.
export const loadDeferred = async <Properties = Record<string, unknown>>(
  app: RequestableApp,
  page: PageObject,
  groups?: string[],
): Promise<PageObject & { props: Properties }> => {
  const requested = Object.entries(page.deferredProps ?? {}).filter(
    ([group]) => !groups || groups.includes(group),
  );
  const loaded = await Promise.all(
    requested.map(([, keys]) => reload(app, page, { only: keys })),
  );
  const properties = loaded.reduce<Record<string, unknown>>(
    (merged, reloaded) => mergeObjects(merged, reloaded.props),
    page.props,
  ) as Record<string, unknown> & Properties;
  return { ...page, props: properties };
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// A deferred prop can sit inside another, e.g. auth.permissions, so its
// response merges into the objects on the way, as the client merges it
const mergeObjects = (
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> => {
  const merged = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const current = merged[key];
    merged[key] =
      isObject(current) && isObject(value)
        ? mergeObjects(current, value)
        : value;
  }
  return merged;
};
