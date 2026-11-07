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

// ---------------------------------------------------------------------------
// From what the server holds to what JSON.stringify sends the client
// ---------------------------------------------------------------------------

type JsonPrimitive = string | number | boolean | null;

// Left out of an object, and null in an array
type Unsendable = undefined | symbol | ((...arguments_: never[]) => unknown);

type SerializedElement<V> = V extends Unsendable ? null : Serialized<V>;

// Undefined in the type, so JSON leaves the key out at times. unknown counts
// as always present, or every unknown prop would turn optional.
type MaybeUndefined<V> = unknown extends V
  ? false
  : undefined extends V
    ? true
    : false;

// A key whose value can never be sent is dropped, and one that may be
// undefined arrives only sometimes
type SerializedObject<T> = Simplify<
  {
    [
      K in keyof T as K extends symbol
        ? never
        : [T[K]] extends [Unsendable]
          ? never
          : MaybeUndefined<T[K]> extends true
            ? never
            : K
    ]: Serialized<T[K]>;
  } & {
    [
      K in keyof T as K extends symbol
        ? never
        : [T[K]] extends [Unsendable]
          ? never
          : MaybeUndefined<T[K]> extends true
            ? K
            : never
    ]?: Serialized<Exclude<T[K], undefined>>;
  }
>;

// JSON.stringify's rules: toJSON() decides first, so a Date arrives as a
// string; Map and Set have no own enumerable properties. BigInt stays, because
// the adapter sends it as a marker the client (3.8+) turns back into a BigInt.
export type Serialized<T> = 0 extends 1 & T
  ? T
  : unknown extends T
    ? unknown
    : T extends JsonPrimitive | bigint
      ? T
      : T extends Unsendable
        ? never
        : T extends { toJSON: (...arguments_: never[]) => infer R }
          ? Serialized<R>
          : T extends ReadonlyMap<unknown, unknown> | ReadonlySet<unknown>
            ? Record<string, never>
            : T extends readonly unknown[]
              ? { [I in keyof T]: SerializedElement<T[I]> }
              : T extends object
                ? SerializedObject<T>
                : never;

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

// An index signature, such as an untyped share() returning
// Record<string, unknown>, says nothing about the keys, so only named keys
// are kept. Dropping the whole type instead would also drop what typed
// middlewares on the same chain share.
type KnownKeys<V> = {
  [
    K in keyof V as string extends K
      ? never
      : number extends K
        ? never
        : symbol extends K
          ? never
          : K
  ]: V[K];
};

// Several middlewares record their shared props as an intersection, which
// infer V merges
type SharedProperties<App> =
  AppEnvironment<App> extends InertiaSharedEnv<infer V>
    ? Serialized<ResolvedProperties<KnownKeys<V>>>
    : object;

// The props every page gets from share() and inertiaShare(), without errors.
// The file the Vite plugin generates can declare them for the client.
export type SharedProps<App> = SharedProperties<App>;

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

// Each route's props as the client receives them, before Normalize fills in
// the keys other routes send
type SerializedEach<U> = U extends unknown ? Serialized<U> : never;

type RegisteredApp = AppRegistry extends { app: infer A } ? A : never;

// Kept separate from PageProps so tests can pass an app without the registry
export type PagePropsFor<
  App,
  C extends RenderOutput<App>['component'],
> = C extends unknown
  ? MergeProperties<
      SharedProperties<App>,
      Normalize<
        SerializedEach<Extract<RenderOutput<App>, { component: C }>['props']>
      >
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
