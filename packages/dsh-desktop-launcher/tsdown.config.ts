/**
 * Standalone tsdown config for the desktop-launcher plugin.
 *
 * Uses the repo shared client-bundle preset (shared/tsdown.client.ts —
 * closure-factory artifact for window.__ModuleLoader__, CSS Modules inlined,
 * externals resolved through the loader module table). The node half builds
 * from src (tsdown compiles TS directly) and types ship from lib/types (tsc).
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle(
  '@linxin666/dsh-desktop-launcher',
  ['src/index.ts', 'src/invariant.ts'],
  {
    libExternal: [
      '@deepseek-ai/dsh-settings',
      '@deepseek-ai/dsh-system-prompt',
      '@deepseek-ai/dsh-host-webserver',
    ],
  },
)
