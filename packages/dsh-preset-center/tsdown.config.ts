/**
 * Standalone build config for the preset center.
 * Uses the repo's shared client-bundle preset (shared/tsdown.client.ts).
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@linxin666/dsh-client-ui-preset-center', ['src/index.ts'], {
  libExternal: [
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-slots',
  ],
})
