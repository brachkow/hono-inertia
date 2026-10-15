import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import inertia from '@inertiajs/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

const PORT = 3003;

export default defineConfig({
  plugins: [
    vue(),
    // ssr: false: Workers can't run Inertia's Node SSR server, so the Worker
    // imports src/ssr.ts and renders in-process. The plugin still expands
    // the `pages` shorthand in src/client.ts.
    inertia({ ssr: false }),
    // Runs the Worker in workerd during `vite dev` and `vite preview`
    cloudflare({ viteEnvironment: { name: 'worker' } }),
  ],
  builder: {
    // The Worker inlines the client manifest, so the client builds first
    async buildApp(builder) {
      await builder.build(builder.environments.client);
      await builder.build(builder.environments.worker);
    },
  },
  environments: {
    client: {
      build: {
        // The Worker reads it to build asset tags and the asset version
        manifest: true,
        rollupOptions: { input: 'src/client.ts' },
      },
    },
  },
  server: { port: PORT, strictPort: true },
  preview: { port: PORT, strictPort: true },
});
