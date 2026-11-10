---
description: Validate with Standard Schema, error bags and precognition
---

# Validation

`c.var.inertia.withErrors(errors)` stores validation errors for the next page, which gets them in the `errors` prop. Each field takes a message or an array of messages, and the page gets the first one, as with Laravel's adapter. With `allErrors: true`, pages get every message as an array. `PageProps` still types `errors` with one message per field, as `@inertiajs/core` does. Keeping errors across a redirect needs the [`session`](/guide/sessions) option, and the middleware fails the request when it would lose them:

```ts
app.post('/users', async (c) => {
  const body = await c.req.json();
  if (await emailTaken(body.email)) {
    c.var.inertia.withErrors({ email: 'This email is taken' });
    return c.var.inertia.back();
  }
  await createUser(body);
  return c.redirect('/users');
});
```

When the handler renders a page after `withErrors()` instead of redirecting, that page shows the errors and nothing goes to the session, so this works without the `session` option. An `errors` prop passed to `render()` wins over stored errors.

`inertiaValidator(target, schema)` does this for any [Standard Schema](https://standardschema.dev) library, such as Zod, Valibot or ArkType, and adds no dependency:

```ts
import { z } from 'zod';
import { inertiaValidator } from '@brachkow/hono-inertia';

const userSchema = z.object({
  name: z.string().min(1),
  email: z.email(),
});

app.post('/users', inertiaValidator('json', userSchema), async (c) => {
  const user = c.req.valid('json'); // typed from the schema
  await createUser(user);
  return c.redirect('/users');
});
```

When validation fails, it passes the errors to `withErrors()` and redirects back. A request that is not an Inertia request and accepts JSON gets a 422 with `{ message, errors }` instead. Fields are keyed by their dotted path, such as `items.1.qty`. An issue without a path, such as a refinement over the whole object, goes under `root`. `inertiaValidator()` must run after the `inertia()` middleware.

## Error bags

A page with two forms can keep their errors apart. The client sends the form's bag name in `X-Inertia-Error-Bag` and reads `errors[bag]`:

```ts
form.post('/login', { errorBag: 'login' });
```

The adapter follows Laravel's rules for stored errors. With the header, the errors from `withErrors()` arrive under the requested name. Without it, they arrive unwrapped. Errors stored with an explicit bag, `withErrors(errors, 'login')`, arrive under their own names only when there are no errors in the default bag.

## Precognition

[Precognition](https://inertiajs.com/docs/v3/the-basics/forms#precognition-2) validates a form as the user fills it in, with the same rules as the real submit. `inertiaValidator()` answers precognition requests itself and never runs the handler for them. It responds with 204 when the fields in `Precognition-Validate-Only` pass, or with 422 and their errors. On the client, enable it with `withPrecognition()` and call `validate()`:

```ts
const form = useForm({ name: '', email: '' }).withPrecognition(
  'post',
  '/users',
);

// On blur
form.validate('email');
```

Precognition responses and real responses for one URL differ, so `inertiaValidator()` adds `Vary: Precognition` to both.
