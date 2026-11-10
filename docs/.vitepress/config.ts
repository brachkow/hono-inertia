import { defineConfig } from 'vitepress';
import llmstxt from 'vitepress-plugin-llms';

// Served from GitHub Pages at brachkow.github.io/hono-inertia
export default defineConfig({
  title: 'hono-inertia',
  description: 'Inertia.js v3 server-side adapter for Hono',
  base: '/hono-inertia/',
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      {
        text: 'Changelog',
        link: 'https://github.com/brachkow/hono-inertia/releases',
      },
    ],
    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Protocol support', link: '/guide/protocol-support' },
          { text: 'Configuration', link: '/guide/configuration' },
        ],
      },
      {
        text: 'Frameworks',
        items: [
          { text: 'React', link: '/guide/react' },
          { text: 'Vue', link: '/guide/vue' },
          { text: 'Svelte', link: '/guide/svelte' },
        ],
      },
      {
        text: 'Pages and props',
        items: [
          { text: 'Rendering pages', link: '/guide/rendering' },
          { text: 'Shared data', link: '/guide/shared-data' },
          { text: 'Prop types', link: '/guide/props' },
          { text: 'View data and head elements', link: '/guide/view-data' },
        ],
      },
      {
        text: 'Requests',
        items: [
          { text: 'Redirects', link: '/guide/redirects' },
          { text: 'Sessions', link: '/guide/sessions' },
          { text: 'Validation', link: '/guide/validation' },
          { text: 'Flash messages', link: '/guide/flash-messages' },
          { text: 'History encryption', link: '/guide/history-encryption' },
        ],
      },
      {
        text: 'Build and deploy',
        items: [
          { text: 'Asset versioning', link: '/guide/assets' },
          { text: 'SSR', link: '/guide/ssr' },
        ],
      },
      {
        text: 'Tooling',
        items: [
          { text: 'TypeScript', link: '/guide/typescript' },
          { text: 'Testing', link: '/guide/testing' },
          { text: 'DevTools', link: '/guide/devtools' },
        ],
      },
      {
        text: 'Reference',
        items: [{ text: 'Security', link: '/guide/security' }],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/brachkow/hono-inertia' },
    ],
    editLink: {
      pattern: 'https://github.com/brachkow/hono-inertia/edit/main/docs/:path',
    },
    search: { provider: 'local' },
  },
  // Writes llms.txt and llms-full.txt, and a Markdown copy of every page
  vite: { plugins: [llmstxt()] },
});
