/**
 * Build config for @linxin666/dsh-perf: node-half lib/ plus the browser
 * bundle lib/client.js, same client-bundle preset the family packages keep.
 * The Better Session import runner is an additional standalone node artifact
 * (lib/better-session-import.mjs): the host half spawns it as a child process
 * so legacy-log decoding never blocks the server event loop, and
 * scripts/dsh-better-session.mjs imports it directly.
 */
import type { UserConfig } from 'tsdown'
import { clientBundle } from '../../shared/tsdown.client.ts'

const betterSessionImportRunner: UserConfig = {
  name: '@linxin666/dsh-perf/better-session-import',
  entry: { 'better-session-import': 'src/bsm/import-worker-entry.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
}

export default clientBundle('@linxin666/dsh-perf', ['src/index.ts'], {
  companions: [betterSessionImportRunner],
})
