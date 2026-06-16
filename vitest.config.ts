import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    // Only our suite — never the vendored upstream specs under .inertia/
    include: ['tests/**/*.test.ts'],
  },
})
