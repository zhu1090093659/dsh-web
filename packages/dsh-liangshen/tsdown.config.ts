/**
 * Standalone build config for the dsh-liangshen plugin.
 *
 * Uses the repo's shared client-bundle preset (shared/tsdown.client.ts): the
 * node half (preset sync + announcement) builds to lib/, and the preset picks
 * up the browser half from `src/client/index.ts` automatically, emitting
 * lib/client.js as a closure-factory artifact for the GUI's __ModuleLoader__
 * with its CSS Modules inlined.
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@linxin666/dsh-liangshen', ['src/index.ts'], {
  libExternal: ['@deepseek-ai/dsh-system-prompt'],
})
