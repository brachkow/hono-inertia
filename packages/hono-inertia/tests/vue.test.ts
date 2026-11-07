import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, createSSRApp, effect, h, reactive, ref } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { usePageProps } from '../src/vue.js';

// The same shape as @inertiajs/vue3's usePage(): one reactive object whose
// props is computed from the page ref a visit replaces
type SetPage = (properties: Record<string, unknown>) => void;

const inertia = vi.hoisted(() => ({ setPage: null as SetPage | null }));

const setPage: SetPage = (properties) => inertia.setPage?.(properties);

vi.mock('@inertiajs/vue3', () => {
  const page = ref<{ props: Record<string, unknown> }>({ props: {} });
  const accessor = reactive({ props: computed(() => page.value.props) });
  inertia.setPage = (properties) => {
    page.value = { props: properties };
  };
  return { usePage: () => accessor };
});

describe('usePageProps', () => {
  beforeEach(() => {
    setPage({});
  });

  it('reads the current page props', () => {
    const name = 'Ada';
    setPage({ name });

    const page = usePageProps();

    expect(page).toEqual({ name });
  });

  it('gives the next page props after a visit', () => {
    const page = usePageProps();
    const next = 'Grace';

    setPage({ name: next });

    expect(Reflect.get(page, 'name')).toBe(next);
  });

  it('reruns an effect that read a prop when the page changes', () => {
    setPage({ count: 1 });
    const page = usePageProps();
    const seen: unknown[] = [];
    effect(() => seen.push(Reflect.get(page, 'count')));

    setPage({ count: 2 });

    expect(seen).toEqual([1, 2]);
  });

  it('lists the keys of the current page', () => {
    setPage({ name: 'a', errors: {} });
    const page = usePageProps();

    setPage({ count: 1 });

    expect({ keys: Object.keys(page), has: 'count' in page }).toEqual({
      keys: ['count'],
      has: true,
    });
  });

  it('refuses writes', () => {
    setPage({ name: 'Ada' });
    const page = usePageProps();

    expect(Reflect.set(page, 'name', 'Grace')).toBe(false);
  });

  it('renders inside a component', async () => {
    const name = 'Ada';
    setPage({ name });
    const app = createSSRApp({
      setup: () => {
        const page = usePageProps();
        return () => h('p', String(Reflect.get(page, 'name')));
      },
    });

    const html = await renderToString(app);

    expect(html).toBe(`<p>${name}</p>`);
  });
});
