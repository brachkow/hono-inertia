---
description: Send requests the way the Inertia client does in tests
---

# Testing

`@brachkow/hono-inertia/testing` sends requests the way the Inertia client does and reads the page object back. It works with any test runner:

```ts
import { getPage, inertiaRequest } from '@brachkow/hono-inertia/testing';

it('lists users', async () => {
  const page = await getPage(await inertiaRequest(app, '/users'));

  expect(page.component).toBe('Users/Index');
  expect(page.props.users).toHaveLength(3);
});

it('loads deferred stats', async () => {
  const response = await inertiaRequest(app, '/users', {
    partial: { component: 'Users/Index', only: ['stats'] },
  });

  expect((await getPage(response)).props.stats).toEqual({ total: 3 });
});
```

`reload(app, page, { only, except, reset })` makes a partial reload of a page, as `router.reload()` does, with the page's URL, component and version. `loadDeferred(app, page, groups?)` loads its deferred props the way the client does after it renders, one partial reload per group, and returns the page with their values merged in:

```ts
import {
  getPage,
  inertiaRequest,
  loadDeferred,
  reload,
} from '@brachkow/hono-inertia/testing';

it('loads every deferred prop', async () => {
  const page = await getPage(await inertiaRequest(app, '/users'));

  const loaded = await loadDeferred(app, page);

  expect(loaded.props.stats).toEqual({ total: 3 });
});

it('reloads the filters', async () => {
  const page = await getPage(await inertiaRequest(app, '/users'));

  const reloaded = await reload(app, page, { only: ['filters'] });

  expect(reloaded.props.filters).toEqual(['active']);
});
```

`inertiaRequest(app, path, options)` takes `method`, `json` or `body`, `headers`, `version`, `partial`, `reset`, `errorBag` and `exceptOnceProps`. Pass `inertia: false` for a first visit, which gets HTML. It sends no `X-Inertia-Version` unless you pass `version`, so tests never hit a version 409 by accident. `getPage(response)` reads the page from JSON or from the first visit's HTML, and throws when the response is neither. `inertiaHeaders(options)` returns just the headers.
