---
layout: home
description: Inertia.js v3 server-side adapter for Hono, with typed page props, SSR on Node.js and Cloudflare Workers, and a Vite plugin

hero:
  name: hono-inertia
  text: Inertia.js v3 for Hono
  tagline: The full Inertia v3 protocol, on Node.js and Cloudflare Workers
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/brachkow/hono-inertia

features:
  - title: One-line setup
    details: With the Vite plugin, inertia({ assets }) gives the asset version, the page's asset tags, SSR and a built-in root template.
  - title: Typed page props
    details: PageProps<'Users/Index'> gives each page the props its routes send, for React, Vue and Svelte.
  - title: SSR in the same process
    details: Pages render inside the Node.js server or the Worker, with no separate SSR server to run.
  - title: Every prop type
    details: Optional, always, deferred, merge, scroll, once and live props, nested props, sessions, validation and precognition.
---

It has powered [Things To Have](https://thingstohave.app) in production since early 2026 with 0 issues.
