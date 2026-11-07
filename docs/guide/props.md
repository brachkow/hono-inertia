---
description: Optional, always, deferred, merge, scroll, once and live props
---

# Prop types

## `always(value)`

Included in every response, including partial reloads:

```ts
import { always } from '@brachkow/hono-inertia';

c.var.inertia.render('Dashboard', {
  auth: always({ user: currentUser }),
});
```

## `optional(fn)`

Excluded from initial visits. Included only when a partial reload requests it:

```ts
import { optional } from '@brachkow/hono-inertia';

c.var.inertia.render('Users/Index', {
  permissions: optional(() => fetchPermissions()),
});
```

## `deferred(fn, group?)`

Excluded from the initial response. The client fetches the prop after mount:

```ts
import { deferred } from '@brachkow/hono-inertia';

c.var.inertia.render('Dashboard', {
  stats: deferred(() => computeStats()),
  comments: deferred(() => fetchComments(), 'sidebar'),
  likes: deferred(() => fetchLikes(), 'sidebar'),
});
```

Chain `.rescue()` so one failing deferred prop does not fail the whole response. If the function throws, the adapter passes the error to the `onRescue` config callback (default `console.error`), sends the prop as `null`, and lists its key in `page.rescuedProps`. The client's `<Deferred>` component then renders its `rescue` slot (or the fallback) instead of the default content:

```ts
c.var.inertia.render('Dashboard', {
  stats: deferred(() => computeStats()).rescue(),
});
```

## `merge(value)` / `prepend(value)` / `deepMerge(value)`

The client appends, prepends, or deep-merges new data instead of replacing it. Use these for feeds that load more data over time:

```ts
import { merge, prepend, deepMerge } from '@brachkow/hono-inertia';

c.var.inertia.render('Feed', {
  posts: merge(() => fetchPosts(page)),
  newPosts: prepend(() => fetchNewPosts()),
  settings: deepMerge(() => fetchSettings()),
});
```

Use `.matchOn(field)` to match array items by a field, or pass several fields:

```ts
c.var.inertia.render('Feed', {
  posts: merge(() => fetchPosts()).matchOn('id'),
});
```

When the list sits inside the prop, merge at its path instead. `.append(path, matchOn?)` and `.prepend(path, matchOn?)` merge the arrays at those paths and replace everything else, so a paginated response keeps its `meta`:

```ts
c.var.inertia.render('Feed', {
  // { data: Post[], meta: { total } }
  posts: merge(() => fetchPostsPage(page)).append('data', 'id'),
});
```

Without a path, `.append()` and `.prepend()` merge the whole prop. The same methods work on `deferred()`, and any of them turns merging on there.

## `scroll(value, options)`

`scroll()` provides the data for the client's `<InfiniteScroll>` component. `value` is the array of rows for the current page. Pass the current page and either `hasMore` or `lastPage`, and the adapter works out the previous and next pages:

```ts
import { scroll } from '@brachkow/hono-inertia';

app.get('/feed', async (c) => {
  const page = Number(c.req.query('page') ?? 1);
  const { rows, lastPage } = await fetchPosts(page);

  return c.var.inertia.render('Feed', {
    posts: scroll(rows, { page, lastPage }),
  });
});
```

The previous page is `page - 1` above page 1. The next page is `page + 1` while `hasMore` is `true`, or while `page` is below `lastPage`. For cursor pagination, pass the cursors yourself: `scroll(rows, { page: cursor, previousPage, nextPage })`. `pageName` sets the query parameter the client sends the page in, and defaults to `'page'`.

`<InfiniteScroll>` requires this prop. It throws at mount if the page object has no
`scrollProps` entry matching its `data` name, so `merge()` is not a substitute.

The adapter registers the prop for merging and takes the direction from the client's `X-Inertia-Infinite-Scroll-Merge-Intent` header (append when scrolling down, prepend when scrolling up). As in inertia-laravel, it tells the client to reset the accumulated collection only when `X-Inertia-Reset` names the prop, for example after `router.reload({ reset: ['posts'] })`.

Use `.matchOn(field)` so refetched pages update existing rows instead of duplicating them:

```ts
c.var.inertia.render('Feed', {
  posts: scroll(rows, { page, lastPage }).matchOn('id'),
});
```

Without it, a partial reload that returns a page the client already holds appends a second
copy of those rows. With it, the client updates matching rows in place. Pass the field name on
its own. The adapter prefixes it with the prop key (`posts` and `id` become `posts.id`).

## `once(fn, options?)`

The adapter resolves it once, and the client caches it across navigations:

```ts
import { once } from '@brachkow/hono-inertia';

const DAY = 24 * 60 * 60 * 1000;

c.var.inertia.render('Pricing', {
  plans: once(() => fetchPlans()),
  config: once(() => fetchConfig(), { key: 'app-config', ttl: DAY }),
});
```

`ttl` is in milliseconds. The client asks for the prop again once that much time has passed since the server sent it. `key` shares the cached value between props with the same key, also on other pages. `optional()` and `deferred()` take the same options in `.once(options)`.

A full visit leaves out a once prop the client already holds, and a partial reload that names it sends a fresh value.

## `live(value, options)`

Refreshes the prop when a broadcast event arrives (client 3.10+). The client subscribes to the channels in `page.liveProps` and makes a partial reload for the props that listen to an event:

```ts
import { live } from '@brachkow/hono-inertia';

c.var.inertia.render('Orders/Show', {
  order: live(() => db.orders.find(id), {
    channel: { name: `orders.${id}`, type: 'private' },
    on: 'OrderUpdated',
    throttle: 5000, // optional, in ms. The client default is 1000
  }),
});
```

A bare string `channel` is a public channel. The other types are `private`, `presence` and `encrypted-private`. Pass the name without a broadcaster prefix such as `private-`, because the client transport adds it. `channel` and `on` also take arrays, and every `.live()` call pairs its channels with its own events:

```ts
live(() => fetchOrders(), { channel: 'orders', on: 'OrderCreated' }).live({
  channel: { name: 'admin', type: 'private' },
  on: ['OrderRefunded', 'OrderDeleted'],
});
```

`always`, `optional`, `deferred` and `once` props become live with `.live(options)`. Their listeners go on the first visit even when the prop itself does not, and the client refreshes an optional prop only after it loaded it. A merge prop cannot be live, so `deferred(fn).merge().live()` throws.

The adapter only describes the subscriptions. Your app sends the events through a broadcaster, such as Pusher, a Pusher-compatible server like Soketi or Reverb, or Action Cable. The client needs a matching transport in `createInertiaApp({ live })`. See [Live props](https://inertiajs.com/docs/v3/data-props/live-props) in the Inertia docs.

An event can carry the new values, so listening pages write them without a request. Every subscriber gets the same payload, so put in it only what all of them may see:

```ts
import { broadcastProperties } from '@brachkow/hono-inertia';

await pusher.trigger(`private-orders.${id}`, 'OrderUpdated', {
  ...broadcastProperties({ order }),
});
```

The client sends its connection id as `X-Socket-Id`. Read it with `c.var.inertia.socketId()` to skip the connection that caused the change:

```ts
await pusher.trigger(channel, 'OrderUpdated', payload, {
  socket_id: c.var.inertia.socketId() ?? undefined,
});
```

## Chaining

You can combine prop types:

```ts
// Deferred + merge + once
deferred(() => fetchFeed(), 'main')
  .merge()
  .once();

// Deferred + prepend
deferred(() => fetchNew(), 'top').prepend();

// Optional + once
optional(() => fetchExpensiveData()).once({
  key: 'cache-key',
  ttl: 60 * 60 * 1000,
});

// Deep merge with match key
deepMerge(() => fetchItems()).matchOn('id');

// Infinite scroll matching rows by id
scroll(rows, { page, hasMore }).matchOn('id');

// Deferred + live
deferred(() => fetchStats()).live({ channel: 'stats', on: 'StatsChanged' });
```
