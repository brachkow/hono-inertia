# @brachkow/hono-inertia

> How stable is it? It has powered [Things To Have](https://thingstohave.app) in production since early 2026 with 0 issues

Full-featured Inertia.js v3 server-side adapter for [Hono](https://hono.dev).

Documentation: **[brachkow.github.io/hono-inertia](https://brachkow.github.io/hono-inertia/)**

## Features

- Full support of the Inertia v3 protocol
- `inertia({ assets })` is the whole setup with the Vite plugin: a [built-in root template](https://brachkow.github.io/hono-inertia/guide/configuration#root-template), the asset version and SSR come from it
- [Typed page props](https://brachkow.github.io/hono-inertia/guide/typescript#typed-page-props) for React, Vue and Svelte
- Simple SSR [setup](https://brachkow.github.io/hono-inertia/guide/ssr), with examples for [Vue](https://github.com/brachkow/hono-inertia/tree/main/examples/vue-node), [React](https://github.com/brachkow/hono-inertia/tree/main/examples/react-node) and [Svelte](https://github.com/brachkow/hono-inertia/tree/main/examples/svelte-node), plus [Vue on Cloudflare Workers](https://github.com/brachkow/hono-inertia/tree/main/examples/vue-workers)
- [Inertia DevTools](https://brachkow.github.io/hono-inertia/guide/devtools) support
- Runs on Cloudflare Workers as well as Node.js
- Works with Hono 4.8+ and Hono 5
- Every Inertia [prop type](https://brachkow.github.io/hono-inertia/guide/props): `optional`, `always`, `deferred`, `merge`, `scroll` and `once`
- [Flash messages](https://brachkow.github.io/hono-inertia/guide/flash-messages), [history encryption](https://brachkow.github.io/hono-inertia/guide/history-encryption), [view data](https://brachkow.github.io/hono-inertia/guide/view-data#view-data) and the rest in the [documentation](https://brachkow.github.io/hono-inertia/)

## Install

```bash
pnpm add hono @brachkow/hono-inertia
```

The [getting started guide](https://brachkow.github.io/hono-inertia/guide/getting-started) sets up a Hono app with Vite and the Inertia client, and the [React](https://brachkow.github.io/hono-inertia/guide/react), [Vue](https://brachkow.github.io/hono-inertia/guide/vue) and [Svelte](https://brachkow.github.io/hono-inertia/guide/svelte) guides cover each framework. The [examples](https://github.com/brachkow/hono-inertia/tree/main/examples) are complete apps for React, Vue and Svelte on Node.js, and Vue on Cloudflare Workers.

## License

MIT
