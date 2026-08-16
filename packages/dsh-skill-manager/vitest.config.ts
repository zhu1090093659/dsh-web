import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [tsconfigPaths({
    projects: ['./tsconfig.vitest.json'],
  })],
  server: {
    sourcemapIgnoreList: () => true,
  },
  test: {
    include: ['tests/**/*.spec.{ts,tsx}'],
    pool: 'forks',
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    server: {
      deps: {
        inline: [/@deepseek-ai\//],
      },
    },
  },
})
