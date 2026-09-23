/**
 * Host half of the preset center: mounts the loopback-only preset-library
 * gateway (see `routes.ts`) that the Workshop's Presets panel drives, and owns
 * the registry declarations that make an installed preset live.
 *
 * The library itself is plain filesystem state under `$DSH_HOME` (see
 * `core/library.ts`) and the declarations are process state, so a preset
 * disabled by another process or deleted by hand is reported from disk on the
 * next read. Nothing is declared on plugin load: a downloaded composition is
 * code, and only an explicit confirmation from the panel declares it.
 * @module @linxin666/dsh-client-ui-preset-center
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { AgentPresetRegistry } from '@deepseek-ai/dsh-agent-preset-registry'
import { mountOnce } from './mount-once.ts'
import { PresetDeclarations } from './host/declarations.ts'
import { makePresetCenterRoutes } from './routes.ts'

/** Stable cordis plugin name (matches the cordis.patch.yml insert id). */
export const name = 'ui-preset-center'

/** The gateway requires the host webserver; the registry is read opportunistically. */
export const inject = ['webServer']

/** Mount the preset-center gateway (once per process). */
export const apply = mountOnce('@linxin666/dsh-client-ui-preset-center', applyImpl)

function applyImpl(ctx: Context): void {
  const declarations = new PresetDeclarations(() => ctx.get('agentPresets') as AgentPresetRegistry | undefined)
  ctx.effect(() => () => declarations.release(), 'dsh-preset-center: preset declarations')
  const routes = makePresetCenterRoutes({ ctx, declarations })
  for (const route of routes) {
    try {
      ctx.effect(() => {
        const dispose = ctx.webServer.register(route)
        return () => { dispose() }
      }, `dsh-preset-center: route ${route.path}`)
    } catch {
      /* settings-only install: the panel degrades to a gateway-unavailable note */
    }
  }
}

export { makePresetCenterRoutes, PRESET_CENTER_API_PREFIX, COMPOSITION_MAX_BYTES } from './routes.ts'
export type { PresetCenterRouteDeps } from './routes.ts'
export {
  listPresetStates,
  readPresetState,
  scanPresetIds,
  uninstallPreset,
  libraryDirOf,
  PresetOperationError,
} from './core/library.ts'
export type { PresetOperationCode, PresetStateRow } from './core/library.ts'
export { profileComposition, profilePresetDir, needsConfirmation } from './core/profile.ts'
export type { CodeExecution, CompositionProfile } from './core/profile.ts'
export { readProvenance, verifyProvenance, listFiles } from './core/provenance.ts'
export type { PresetProvenance, ProvenanceReport, ProvenanceState } from './core/provenance.ts'
export {
  COMPOSITION_FILE,
  LIBRARY_DIR,
  METADATA_FILE,
  PRESET_ID_RE,
  PROVENANCE_FILENAME,
  isPresetId,
  libraryRoot,
} from './core/paths.ts'
export { presetDefinition, readCompositionRows, readPresetDefinition, readPresetMetadata } from './core/definition.ts'
export type { PresetMetadata } from './core/definition.ts'
export { readCordisYaml, CompositionError } from './core/yaml.ts'
export type { JsExpression } from './core/yaml.ts'
export { DeclarationError, PresetDeclarations } from './host/declarations.ts'
export type { DeclarationFailure, PresetRegistry } from './host/declarations.ts'
