import { defineConfig } from 'vitest/config'

export default defineConfig({
  server: {
    sourcemapIgnoreList: () => true,
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    pool: 'forks',
    environment: 'node',
  },
})
