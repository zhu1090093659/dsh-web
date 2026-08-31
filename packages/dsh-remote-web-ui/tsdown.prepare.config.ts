import { clientBundle } from '../../shared/tsdown.client.ts'

/**
 * Consumer-side build for git installs (the `prepare` script): transpile
 * straight from src without tsc project references, which need the sibling
 * harness checkout that only dev machines and CI have. Types are NOT
 * checked here — `pnpm run typecheck` owns that. The client bundle is
 * emitted too: the modules node half serves lib/client.js to browsers, so a
 * git-installed package must ship it. (The standalone mobile bundle was
 * removed in 0.4.0 — the official UI is adapted in place, so this config
 * mirrors tsdown.config.ts exactly.)
 */
export default clientBundle('@linxin666/dsh-remote-web-ui', ['src/index.ts', 'src/invariant.ts'])
