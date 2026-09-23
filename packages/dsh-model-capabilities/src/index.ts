/**
 * Host loader entry for the dsh-model-capabilities plugin — runs in the DSH host process.
 *
 * The plugin's own Cordis config IS its settings entry: `disabled` archives
 * the profiles of disabled providers (disabling stashes the profile here and
 * unsets `llm-pi-ai.providers.<route>`, the official Remove-provider seam,
 * which unregisters the route and takes the provider out of the model catalog
 * both the composer picker and the subagent selection read; enabling restores
 * the profile). The archive holds configuration only — API keys stay in the
 * credentials service and are untouched by a toggle. The Host derives the
 * settings page of this row from this schema and serves the `disabled` field
 * to the browser half as a writable form, so the host half registers nothing
 * itself.
 * @module @linxin666/dsh-client-ui-model-capabilities
 */
import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { mountOnce } from './mount-once.ts'

/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
export const name = 'ui-model-capabilities'

/**
 * Live plugin config: the disabled-provider archive, keyed by provider route
 * id. The Host validates the raw profile config and hands the archive over as
 * a stable reference it updates in place, which is also what makes this row's
 * settings page render and accept writes.
 */
export interface Config {
  /** route id -> stashed provider profile (plus its display name). */
  disabled: Volatile<Record<string, unknown>>
}

/**
 * Plugin config schema: the archive the browser half reads and writes.
 *
 * `disabled` is declared volatile, which is what makes it a settings field at
 * all on 0.1.7: the Host serves only volatile config fields as a writable form
 * (a schema with no volatile field is not served), and the Loader commits a
 * volatile-only change into the live reference instead of remounting this row.
 */
export const Config = z.object({
  disabled: z.any().default({}).volatile(),
})

/**
 * Mount the plugin row (once per process; the family bundle may add a second
 * row for the same package, and the standalone install keeps its own).
 */
export const apply = mountOnce('@linxin666/dsh-client-ui-model-capabilities', applyImpl)

/**
 * The host half has no runtime work left: the settings page is derived from
 * Config, and the browser half owns every archive read and write over the
 * settings wire. The row stays mounted so that page has an owner.
 */
function applyImpl(): void {}
