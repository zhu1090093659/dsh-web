/**
 * Standalone build config for the task-board SSH provider.
 *
 * Uses the repository's shared client-bundle preset: node-half lib/ plus the
 * browser bundle lib/client.js (closure-factory artifact for the GUI's
 * __ModuleLoader__). The node-half entries point at src and tsdown compiles the
 * TypeScript directly, so the runtime artifacts need no separate tsc emit.
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@linxin666/dsh-client-ui-task-board-ssh', ['src/index.ts'], {
  // Wire layers the host runtime provides: the provider registers model tools
  // through them once the host engine lands.
  libExternal: ['@deepseek-ai/dsh-tools'],
})
