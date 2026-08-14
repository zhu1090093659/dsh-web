/**
 * Standalone build config for the Web UI plugin-group card.
 *
 * Uses the vendored dsh client-bundle preset (build/tsdown.client.ts, the
 * same copy task-board keeps; keep in sync when the dsh version changes):
 * node-half lib/ plus the browser bundle lib/client.js.
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@linxin666/dsh-client-ui-web-ui-settings', ['src/index.ts'])
