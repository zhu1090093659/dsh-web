import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@deepseek-ai/dsh-client-store': resolve(__dirname, 'tests/mocks/dsh-client-store.ts'),
    },
  },
  server: {
    sourcemapIgnoreList: () => true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    server: { deps: { inline: [/@deepseek-ai\//] } },
  },
})
