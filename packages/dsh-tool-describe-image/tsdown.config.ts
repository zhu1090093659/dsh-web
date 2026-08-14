/**
 * Standalone build config for the dsh-tool-describe-image plugin.
 *
 * Uses the repo's shared client-bundle preset (shared/tsdown.client.ts):
 * the node half (tool registration + attach route + settings section +
 * HTTP client) builds to lib/, and the browser half is auto-detected at
 * src/client/index.ts and emitted as lib/client.js. Runtime
 * @deepseek-ai/* peers stay external; schemastery is a declared
 * dependency and rides the host install too.
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@linxin666/dsh-tool-describe-image', ['src/index.ts', 'src/invariant.ts'], {
  libExternal: [
    '@deepseek-ai/dsh-attachment',
    '@deepseek-ai/dsh-credentials',
    '@deepseek-ai/dsh-launch-environment',
    '@deepseek-ai/dsh-settings',
    '@deepseek-ai/dsh-tools',
    'schemastery',
  ],
})
