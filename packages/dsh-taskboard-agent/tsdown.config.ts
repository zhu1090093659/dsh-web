/**
 * Standalone build config for the dsh-taskboard-agent plugin.
 *
 * Follows the repo's dsh-ssh build shape (shared/tsdown.client.ts preset):
 * node-half lib/ (host bridge: tools + sync API) plus the browser bundle
 * lib/client.js (closure-factory artifact for the GUI's __ModuleLoader__).
 * The client entry lives at src/client/index.ts (directory form, auto-detected
 * by the preset).
 *
 * NOTE: verify with `pnpm --filter @linxin666/dsh-taskboard-agent build`
 * inside the repo workspace before opening the PR.
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@linxin666/dsh-taskboard-agent', ['src/index.ts'], {
  libExternal: [
    '@deepseek-ai/dsh-tools',
  ],
})
