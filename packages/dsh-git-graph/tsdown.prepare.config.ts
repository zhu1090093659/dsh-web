/**
 * Consumer-side build for git installs (the `prepare` script): transpile
 * straight from src without tsc project references (types are NOT checked
 * here — `pnpm run typecheck` owns that).
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@linxin666/dsh-client-ui-git-graph', ['src/index.ts', 'src/invariant.ts'])
