---
description: Share props with every page from the middleware or a handler
---

# Shared data

Global shared props via config:

```ts
inertia({
  share: (c) => ({
    auth: { user: getUser(c) },
    flash: getFlash(c),
  }),
});
```

`c` is Hono's untyped `Context` by default. To read variables that earlier middleware sets, annotate it with your app's Env. `c.get()` then checks the variable names, and [`PageProps`](/guide/typescript#typed-page-props) still picks up what `share` returns. The same works for `c` in `render` and `resolveUrl`:

```ts
interface AppEnv {
  Variables: { session: Session };
}

const app = new Hono<AppEnv>().use(sessionMiddleware).use(
  inertia({
    share: (c: Context<AppEnv>) => ({ user: c.get('session').user }),
    assets,
  }),
);
```

`share` runs inside the `inertia()` middleware, before any middleware that comes after it. To share data that a later middleware loads, such as the user from the session, use `inertiaShare()`. It shares what the function returns and records its type for `PageProps`, like `share` does:

```ts
import { inertia, inertiaShare } from '@brachkow/hono-inertia';

const app = new Hono<AppEnv>()
  .use(inertia({ render }))
  .use(sessionMiddleware)
  .use(
    inertiaShare(async (c: Context<AppEnv>) => {
      // Skips the lookup on routes that render no page
      if (c.req.path.startsWith('/assets/')) return undefined;
      return { locale: c.get('session').locale, user: await loadUser(c) };
    }),
  );
```

Return `undefined` to share nothing. `PageProps` still lists the props, so do that only on routes that render no page.

`c.var.inertia.share()` also shares props per request, but records no type:

```ts
app.use(async (c, next) => {
  c.var.inertia.share({ notifications: getNotifications(c) });
  await next();
});
```

Render props override shared props. Shared props override config-level props.
