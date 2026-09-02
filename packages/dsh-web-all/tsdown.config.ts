/**
 * Build config for the dsh-web-all aggregate: node-half lib/ plus the
 * browser bundle lib/client.js (the compat shim + the client-children
 * mount), same client-bundle preset the family packages keep
 * (shared/tsdown.client.ts). The fault-isolation shell (src/shell.ts + its
 * degraded ledger) ships as additional node-half entries beside lib/index.js
 * — the generated patch rows' `name` mount the per-family subpath exports
 * (`@linxin666/dsh-web-all/<family>`, all resolving to the shared shell
 * re-export lib/shells/shell.js so the plugin inventory can label each row)
 * and the main entry forwards to the shell, while the standalone
 * `@linxin666/dsh-web-all/shell` subpath stays importable for tests and
 * tooling. The shells marker manifest (src/shells/package.json) is copied
 * next to the re-export: the client module scanner's nearest-package walk
 * must stop there instead of reaching the package root's dsh.client face.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { clientBundle } from '../../shared/tsdown.client.ts'

/**
 * The generated client-children list maps each shell-wrapped child's
 * `./client` specifier onto the child's client SOURCE: the built ./client
 * artifacts are loader factory files (they call window.__ModuleLoader__.load
 * on evaluation) and must never be imported from another bundle. tsc reads
 * the generated ambient declarations instead of following these specifiers
 * (src/client/children.modules.d.ts), so the alias only has to exist for
 * rolldown.
 */
interface ClientChildSpecifier {
  name: string
  specifier: string
  source: string
}

const childSpecifiers = JSON.parse(
  readFileSync(fileURLToPath(new URL('./src/client/children.specifiers.json', import.meta.url)), 'utf8'),
) as ClientChildSpecifier[]

const childSources = new Map(
  childSpecifiers.map((child) => [child.specifier, fileURLToPath(new URL(`../../${child.source}`, import.meta.url))]),
)

const childSourceAlias = {
  name: 'dsh-web-all-client-children',
  resolveId(source: string): string | null {
    return childSources.get(source) ?? null
  },
}

export default clientBundle('@linxin666/dsh-web-all', ['src/index.ts'], {
  clientPlugins: [childSourceAlias],
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
