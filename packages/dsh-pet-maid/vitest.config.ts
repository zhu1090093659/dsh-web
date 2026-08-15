import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [tsconfigPaths({
    projects: [
      './tsconfig.vitest.json',
    ],
  })],
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.spec.ts'],
    pool: 'forks',
  },
})
