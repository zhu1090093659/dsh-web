import { defineConfig } from 'vitest/config'

/**
 * This package's host suites drive the protocol state machine over a recording
 * carrier and real node crypto, so node is the default environment and no path
 * aliasing is involved. The browser half's component specs opt into jsdom with
 * a per-file `// @vitest-environment jsdom` docblock, so the node suites keep
 * the cheaper environment. The include list keeps the scan on the two source
 * roots and off the emitted lib/ tree.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    environment: 'node',
    pool: 'forks',
    server: {
      deps: {
        inline: [/@deepseek-ai\//],
      },
    },
  },
})
