/**
 * Standalone build config for the dsh-mermaid plugin.
 *
 * Uses the repo's shared client-bundle preset (shared/tsdown.client.ts):
 * the node half (the settings section + invariants) builds to lib/, and the
 * browser half is auto-detected at src/client/index.ts and emitted as
 * lib/client.js. Runtime @deepseek-ai peers and schemastery stay external;
 * mermaid is a plain dependency bundled into the browser artifact only.
 *
 * mermaid lazy-loads diagram modules through dynamic imports, which would
 * otherwise code-split into sibling chunk files the single-artifact loader
 * never serves; the client override inlines every dynamic import so
 * lib/client.js stays the one self-contained artifact.
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@linxin666/dsh-client-ui-mermaid', ['src/index.ts', 'src/invariant.ts'], {
  libExternal: [
    '@deepseek-ai/dsh-settings',
    'schemastery',
  ],
  client: {
    outputOptions: { inlineDynamicImports: true },
  },
})
