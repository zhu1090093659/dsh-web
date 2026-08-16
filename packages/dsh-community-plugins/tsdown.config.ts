/**
 * Standalone build config for the API-backed community plugin manager.
 *
 * Uses the repo's shared client-bundle preset (shared/tsdown.client.ts):
 * node-half lib/ plus the browser bundle lib/client.js.
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@linxin666/dsh-client-ui-community-plugins', ['src/index.ts'], {
  libExternal: [
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-client-ui-primitives',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-host-webserver',
    '@deepseek-ai/dsh-native-command',
    '@deepseek-ai/dsh-settings',
    '@deepseek-ai/dsh-skill',
    '@deepseek-ai/dsh-tools',
  ],
})
