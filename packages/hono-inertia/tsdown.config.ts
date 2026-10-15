import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/vite.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  // Keep .js/.d.ts so the paths in package.json exports stay valid.
  fixedExtension: false,
});
