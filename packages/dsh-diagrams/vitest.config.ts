import { defineConfig } from 'vitest/config'

/**
 * Host tests (the vendor route) run in the Node environment; the browser-half
 * tests drive the DOM enhancement and need a document. `tests/client/**` gets
 * jsdom, everything else stays on Node so a host test never relies on DOM
 * globals by accident.
 */
export default defineConfig({
  server: {
    sourcemapIgnoreList: () => true,
  },
  test: {
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    environment: 'node',
    server: {
      deps: {
        inline: [/@deepseek-ai\//],
      },
    },
  },
})
