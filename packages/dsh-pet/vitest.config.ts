import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [tsconfigPaths({
    projects: [
      './tsconfig.vitest.json',
    ],
  })],
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    environment: 'jsdom',
    pool: 'forks',
  },
})
