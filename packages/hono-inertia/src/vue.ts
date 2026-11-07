import { usePage } from '@inertiajs/vue3';
import type { PageProps, RenderedPage } from './page-properties.js';

// defineProps<T>() needs every prop name written out in T, so a Vue page
// reads its typed props from the current page instead. usePage().props is a
// computed value that Inertia replaces on every visit and reload, so the
// proxy reads it on each access: a variable holding usePage().props, or a
// destructured prop, keeps the first page's values.
export const usePageProps = <C extends RenderedPage>(): Readonly<
  PageProps<C>
> => {
  const page = usePage();
  const current = (): object => page.props;
  return new Proxy({} as Readonly<PageProps<C>>, {
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
