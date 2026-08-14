import { clientBundle } from '../../shared/tsdown.client.ts'

/**
 * Consumer-side build for git installs (the `prepare` script): transpile
 * straight from src without tsc project references, which need the sibling
 * harness checkout that only dev machines and CI have. Types are NOT
 * checked here — `pnpm run typecheck` owns that. The client bundle is
 * emitted too: the modules node half serves lib/client.js to browsers, so a
 * git-installed package must ship it.
 */
export default clientBundle('@linxin666/dsh-pet', [
  'src/index.ts',
  'src/invariant.ts',
], {
  libExternal: ['@deepseek-ai/dsh-settings'],
})
