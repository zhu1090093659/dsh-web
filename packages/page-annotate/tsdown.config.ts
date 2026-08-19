/**
 * Standalone build config for the page-annotate plugin.
 *
 * Uses the repo's shared client-bundle preset (shared/tsdown.client.ts):
 * node-half lib/ (host screenshot service + routes) plus the browser bundle
 * lib/client.js (closure-factory artifact for the GUI's __ModuleLoader__,
 * CSS Modules inlined). The client entry is auto-detected at
 * src/client/index.ts by the preset. `electron` must stay external: it only
 * exists inside the DSH Desktop shell at runtime (never installed here).
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@linxin666/dsh-page-annotate', ['src/index.ts', 'src/invariant.ts'], {
  libExternal: [
    'electron',
    '@deepseek-ai/dsh-host-webserver',
  ],
})
