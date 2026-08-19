import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The root tsconfig is a solution file (no compilerOptions), so esbuild
  // would fall back to the classic JSX runtime; the specs use react-jsx.
  esbuild: {
    jsx: 'automatic',
  },
  // npm SDK packages reference sourcemaps that are not published (files
  // exclude *.map); do not attempt to load them during transform.
  server: {
    sourcemapIgnoreList: () => true,
  },
  test: {
    include: ['tests/**/*.spec.{ts,tsx}'],
    pool: 'forks',
    // Host specs stay in node (their undici fetch needs Node AbortSignals);
    // the settings-card probe spec opts into jsdom through its docblock.
    setupFiles: ['./vitest.setup.ts'],
    // @deepseek-ai SDK packages ship browser bundles (CSS imports included);
    // keep them vite-transformed instead of node-externalized.
    server: {
      deps: {
        inline: [/@deepseek-ai\//],
      },
    },
  },
})
