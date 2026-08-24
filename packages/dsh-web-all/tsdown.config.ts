/**
 * Build config for the dsh-web-all aggregate: node-half lib/ plus the
 * browser bundle lib/client.js (the compat shim), same client-bundle preset
 * the family packages keep (shared/tsdown.client.ts).
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@linxin666/dsh-web-all', ['src/index.ts'])
