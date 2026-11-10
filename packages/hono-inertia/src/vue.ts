import { usePage } from '@inertiajs/vue3';
import { defineComponent, inject, provide } from 'vue';
import type { InjectionKey, SlotsType, VNode } from 'vue';
import type { PageProps, RenderedPage } from './page-properties.js';

// Without a registered app, as before the pages file exists, any page name
// and any props
type PageKey = [RenderedPage] extends [never] ? string : RenderedPage;

type PagePropertiesOf<C extends PageKey> = C extends RenderedPage
  ? PageProps<C>
  : Record<string, unknown>;

// Props for one subtree, read on each access, so a reactive source updates it
type ProvidedProperties = () => object;

const PAGE_PROPS: InjectionKey<ProvidedProperties> = Symbol(
  'hono-inertia.page-props',
);

// Gives usePageProps() in this component's subtree these props instead of the
// current page's, e.g. to render a page several times with other data in a
// story. Pass a function to read reactive props on each access.
export const providePageProps = <C extends PageKey>(
  properties: PagePropertiesOf<C> | (() => PagePropertiesOf<C>),
): void => {
  provide(
    PAGE_PROPS,
    typeof properties === 'function' ? properties : () => properties,
  );
};

// defineProps<T>() needs every prop name written out in T, so a Vue page
// reads its typed props from the current page instead, or from the closest
// providePageProps(). usePage().props is a computed value that Inertia
// replaces on every visit and reload, so the proxy reads it on each access: a
// variable holding usePage().props, or a destructured prop, keeps the first
// page's values.
export const usePageProps = <C extends PageKey>(): Readonly<
  PagePropertiesOf<C>
> => {
  const provided = inject(PAGE_PROPS, null);
  const page = provided ? undefined : usePage();
  const current = (): object => provided?.() ?? page?.props ?? {};
  return new Proxy({} as Readonly<PagePropertiesOf<C>>, {
    get: (_target, key) => Reflect.get(current(), key),
    has: (_target, key) => Reflect.has(current(), key),
    ownKeys: () => Reflect.ownKeys(current()),
    // The target is empty, so a descriptor for one of its keys has to be
    // configurable
    getOwnPropertyDescriptor: (_target, key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(current(), key);
      return descriptor && { ...descriptor, configurable: true };
    },
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
  });
};

// Renders its slot with `props` as the page props of page `page`:
// <PagePropsProvider page="Settings" :props="fixture"><Settings /></PagePropsProvider>
export const PagePropsProvider = defineComponent(
  <C extends PageKey>(
    component: { page: C; props: PagePropertiesOf<C> },
    { slots }: { slots: { default?: () => VNode[] } },
  ) => {
    // Reads the prop on each access, so new props reach the subtree
    providePageProps<C>(() => component.props);
    return () => slots.default?.();
  },
  {
    name: 'PagePropsProvider',
    props: ['page', 'props'],
    slots: Object as SlotsType<{ default?: () => VNode[] }>,
  },
);
