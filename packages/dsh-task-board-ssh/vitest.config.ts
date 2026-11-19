import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    // src/core is pure logic with no DOM and no storage: the specs run in the
    // node environment, and the launcher specs drive real sh processes.
    environment: 'node',
    pool: 'forks',
  },
})
