/**
 * Standalone tsdown config for the skill-manager plugin.
 *
 * Uses the repo shared client-bundle preset (shared/tsdown.client.ts —
 * closure-factory artifact for window.__ModuleLoader__, CSS Modules inlined,
 * externals resolved through the loader module table). The node half builds
 * from src (tsdown compiles TS directly) and types ship from lib/types (tsc).
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle(
  '@linxin666/dsh-skill-manager',
  ['src/index.ts', 'src/invariant.ts'],
  {
    lib: {
      external: [
        '@deepseek-ai/cordis',
        '@deepseek-ai/dsh-agent',
        '@deepseek-ai/dsh-host-webserver',
        '@deepseek-ai/dsh-scope',
        '@deepseek-ai/dsh-session',
        '@deepseek-ai/dsh-skill',
        'yaml',
      ],
    },
  },
)
