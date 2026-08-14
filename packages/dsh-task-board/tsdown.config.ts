/**
 * Standalone build config for the task-board client plugin.
 *
 * Uses the vendored dsh client-bundle preset (build/tsdown.client.ts, copied
 * from the dsh checkout's packages/client/tsdown.client.ts; keep in sync
 * when the dsh version changes): node-half lib/ plus the browser bundle
 * lib/client.js (closure-factory artifact for the GUI's __ModuleLoader__,
 * CSS Modules inlined with auto-injected <style data-plugin>).
 *
 * Node-half entries point at src (tsdown compiles TS directly), so the build
 * needs no separate tsc emit for runtime artifacts.
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@linxin666/dsh-client-ui-task-board', ['src/index.ts', 'src/invariant.ts'], {
  libExternal: ['@deepseek-ai/dsh-settings'],
})
