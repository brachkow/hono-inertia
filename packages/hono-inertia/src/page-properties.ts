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

// ---------------------------------------------------------------------------
// Checks that a Vue page declares every prop its routes pass
// ---------------------------------------------------------------------------

// Vue's defineProps can't take PageProps, so a Vue page lists its props by
// hand. These types catch a prop the routes pass that the list leaves out.

// The prop names a Vue component declares, from the instance type vue-tsc
// gives it
type VueDeclaredKeys<Component> = Component extends abstract new (
  ...parameters: never[]
) => { $props: infer P }
  ? keyof P
  : never;

// Shared props and errors are left out, also when a route passes errors
// itself: a page reads them only if it needs them
export type MissingVuePagePropsFor<App, C extends string, Component> = Exclude<
  AllKeys<Extract<RenderOutput<App>, { component: C }>['props']>,
  VueDeclaredKeys<Component> | 'errors'
>;

type DeclaresRouteProperties<C extends string, Component> = [
  MissingVuePagePropsFor<RegisteredApp, C, Component>,
] extends [never]
  ? unknown
  : { 'Missing props': MissingVuePagePropsFor<RegisteredApp, C, Component> };

// Fails typecheck, naming the props, when the Vue component of page C leaves
// out a prop its routes pass. The file the Vite plugin generates applies it to
// every .vue page.
export type VuePage<
  C extends PageName,
  Component extends DeclaresRouteProperties<C, Component>,
> = [C, Component];
