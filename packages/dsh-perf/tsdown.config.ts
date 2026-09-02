/**
 * Build config for @linxin666/dsh-perf: node-half lib/ plus the browser
 * bundle lib/client.js, same client-bundle preset the family packages keep.
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@linxin666/dsh-perf', ['src/index.ts'])
