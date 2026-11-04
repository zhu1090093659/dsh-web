/**
 * Standalone tsdown config for the diagrams plugin.
 *
 * Uses the repo's shared client-bundle preset (shared/tsdown.client.ts): the
 * node half carries the vendor route, the browser half the DOM enhancement.
 * The vendored mermaid runtime is COPIED here, never bundled into the client
 * artifact: it is served from the host route on demand, so a page that renders
 * no diagram never downloads it. The copy target is a destination directory
 * (see the aggregate's shells marker for the same shape).
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@linxin666/dsh-client-ui-diagrams', ['src/index.ts'], {
  lib: {
    copy: [{ from: 'node_modules/mermaid/dist/mermaid.min.js', to: 'lib/assets' }],
  },
})
