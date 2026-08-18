import { defineConfig } from '@playwright/test'

/**
 * Headless-render lane config for the aggregate-bundle mount smoke
 * (`scripts/e2e-mount.sh` + `tests/e2e/mount.e2e.ts`). The server is booted
 * by the shell script; the spec only loads the page against `DSH_E2E_URL`.
 * Serial by design: one scratch DSH instance per run.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  // The mount lane files are named *.e2e.ts (mirroring the better-sidebar
  // repo convention) — outside Playwright's default *.test.* match.
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: {
    headless: true,
  },
})
