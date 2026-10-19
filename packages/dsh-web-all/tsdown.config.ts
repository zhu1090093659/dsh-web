/**
 * Build config for the dsh-web-all aggregate: node-half lib/ plus the
 * browser bundle lib/client.js (the compat shim alone), same client-bundle
 * preset the family packages keep (shared/tsdown.client.ts). The browser
 * bundle carries no family code: every family row mounts its real package,
 * so its browser half comes from that package's own loader entry (issue
 * #1901). The fault-isolation shell (src/shell.ts + its degraded ledger)
 * ships as additional node-half entries beside lib/index.js — it still backs
 * the compat row and the per-family subpath exports a pre-#1901 profile may
 * record (they resolve to the shared shell re-export lib/shells/shell.js) —
 * and the main entry forwards to the shell, while the standalone
 * `@linxin666/dsh-web-all/shell` subpath stays importable for tests and
 * tooling. The shells marker manifest (src/shells/package.json) is copied
 * next to the re-export: the client module scanner's nearest-package walk
 * must stop there instead of reaching the package root's dsh.client face.
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@linxin666/dsh-web-all', ['src/index.ts'], {
  companions: [
    {
      name: '@linxin666/dsh-web-all/shell',
      // Object entries pin the output paths: the shells re-export must land
      // exactly at lib/shells/shell.js (the exports map and the scanner
      // marker both depend on that location).
      entry: { shell: 'src/shell.ts', degraded: 'src/degraded.ts', 'shells/shell': 'src/shells/shell.ts' },
      outDir: 'lib',
      format: ['esm'],
      platform: 'node',
      target: 'es2024',
      fixedExtension: false,
      dts: false,
      clean: false,
      sourcemap: true,
      external: ['@deepseek-ai/cordis'],
      // copy 'to' is a destination DIRECTORY: this lands the marker exactly
      // at lib/shells/package.json.
      copy: [{ from: 'src/shells/package.json', to: 'lib/shells' }],
    },
  ],
})
