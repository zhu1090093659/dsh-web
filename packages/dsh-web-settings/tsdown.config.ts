/**
 * Standalone build config for the Web UI plugin-group card.
 *
 * Uses the vendored dsh client-bundle preset (build/tsdown.client.ts, the
 * same copy task-board keeps; keep in sync when the dsh version changes):
 * node-half lib/ plus the browser bundle lib/client.js.
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@linxin666/dsh-client-ui-web-ui-settings', ['src/index.ts'], {
  libExternal: [
    '@deepseek-ai/dsh-api-remotes',
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-store',
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-host-webserver',
    '@deepseek-ai/dsh-settings',
  ],
})
