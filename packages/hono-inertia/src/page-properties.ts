import type { Hono, TypedResponse } from 'hono';
import type { ExtractSchema } from 'hono/types';
import type { TaggedProperty } from './types.js';

// ---------------------------------------------------------------------------
// Registries, filled in by the file the Vite plugin generates
// ---------------------------------------------------------------------------

// Page component names. While empty, render() accepts any string.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- filled by declaration merging
export interface InertiaPages {}

// The Hono app that PageProps reads route outputs from:
// `interface AppRegistry { app: typeof app }`
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- filled by declaration merging
export interface AppRegistry {}

export type PageName = keyof InertiaPages extends never
  ? string
  : Extract<keyof InertiaPages, string>;

// ---------------------------------------------------------------------------
// From the props a handler passes to what the page component receives
// ---------------------------------------------------------------------------

type Resolved<V> = V extends () => infer R ? Awaited<R> : V;

type PropertyValue<V> = V extends TaggedProperty
  ? V extends { value: infer F }
    ? Resolved<F>
    : never
  : Resolved<V>;

// Left out of the first visit, so the component sees them as possibly missing
type MissingOnFirstVisit =
  | { __hono_inertia_prop_type__: 'optional' }
  | { __hono_inertia_prop_type__: 'deferred' };

type OptionalKeys<P> = {
  [K in keyof P]: P[K] extends MissingOnFirstVisit ? K : never;
}[keyof P];

type Simplify<T> = { [K in keyof T]: T[K] } & {};

export type ResolvedProperties<P> = Simplify<
  { [K in Exclude<keyof P, OptionalKeys<P>>]: PropertyValue<P[K]> } & {
    [K in OptionalKeys<P>]?: PropertyValue<P[K]>;
  }
>;

// What render() returns: a Response whose type also records the component
// and its props, so PageProps can read them from the app's routes
export type RenderResponse<C extends string, P> = Response &
  TypedResponse<{ component: C; props: ResolvedProperties<P> }, 200, 'html'>;

// ---------------------------------------------------------------------------
// Shared props, carried in the app's Env by the middleware
// ---------------------------------------------------------------------------

declare const SHARED_PROPS: unique symbol;

export interface InertiaSharedEnv<V> {
  Variables: { [SHARED_PROPS]: V };
}

// Hono 4.8 has three type parameters and later versions four, so only the
// first is matched
type AppEnvironment<App> = App extends Hono<infer E> ? E : never;

// Without a typed share(), V is the Record<string, unknown> default, which
// says nothing about the keys
type SharedProperties<App> =
  AppEnvironment<App> extends InertiaSharedEnv<infer V>
    ? string extends keyof V
      ? object
      : ResolvedProperties<V>
    : object;

// ---------------------------------------------------------------------------
// PageProps
// ---------------------------------------------------------------------------

// Matches @inertiajs/core: field errors, or field errors per error bag
type Errors = Record<string, string>;
type ErrorBag = Record<string, Errors>;

type Outputs<App> = {
  [Path in keyof ExtractSchema<App>]: {
    [
      Method in keyof ExtractSchema<App>[Path]
    ]: ExtractSchema<App>[Path][Method] extends {
      output: infer O;
    }
      ? O
      : never;
  }[keyof ExtractSchema<App>[Path]];
}[keyof ExtractSchema<App>];

type RenderOutput<App> =
  Outputs<App> extends infer U
    ? U extends { component: string; props: unknown }
      ? U
      : never
    : never;

type AllKeys<T> = T extends unknown ? keyof T : never;

// A page rendered from several routes gets the union of their props. Each
// member lists every key, so reading a key only some routes send type-checks
// and gives possibly undefined.
type Normalize<T, All = T> = T extends unknown
  ? Simplify<T & Partial<Record<Exclude<AllKeys<All>, keyof T>, undefined>>>
  : never;

type MergeProperties<Shared, Own> = Own extends unknown
  ? Simplify<Omit<Shared, keyof Own> & Own & { errors: Errors & ErrorBag }>
  : never;

type RegisteredApp = AppRegistry extends { app: infer A } ? A : never;

// Kept separate from PageProps so tests can pass an app without the registry
export type PagePropsFor<
  App,
  C extends RenderOutput<App>['component'],
> = C extends unknown
  ? MergeProperties<
      SharedProperties<App>,
      Normalize<Extract<RenderOutput<App>, { component: C }>['props']>
    >
  : never;

// The props a page component receives, taken from the routes that render it
export type PageProps<C extends RenderOutput<RegisteredApp>['component']> =
  PagePropsFor<RegisteredApp, C>;
