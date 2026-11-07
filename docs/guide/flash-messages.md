---
description: Send one-shot messages to the next page
---

# Flash messages

Send one-shot messages (toasts, alerts) to the client. The client passes them to the `onFlash` callback and the `inertia:flash` event on the next render, including the initial visit. Then it clears them from history so they don't replay on back/forward:

```ts
app.post('/users', async (c) => {
  await createUser(c);
  c.var.inertia.flash({ success: 'User created' });
  return c.var.inertia.render('Users/Index', { users });
});
```

`flash()` accumulates across calls, and later keys win. Flash data is a top-level field and never mixes into your props.

With the [`session`](/guide/sessions) option, flash data set before a redirect shows on the next page:

```ts
app.post('/users', async (c) => {
  await createUser(c);
  c.var.inertia.flash({ success: 'User created' });
  return c.redirect('/users');
});
```

Without it, `flash()` applies to the current response only.
