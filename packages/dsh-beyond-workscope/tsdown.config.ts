/**
 * Standalone build config for the dsh-beyond-workscope plugin.
 *
 * Uses the repo's shared client-bundle preset (shared/tsdown.client.ts):
 * node-half lib/ (host perception + grant registry + routes + tools) plus the
 * browser bundle lib/client.js (closure-factory artifact for the GUI's
 * __ModuleLoader__, CSS Modules inlined with auto-injected <style data-plugin>).
 * The client entry is auto-detected at src/client/index.ts by the preset.
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@linxin666/dsh-beyond-workscope', ['src/index.ts', 'src/invariant.ts'], {
  libExternal: [
    '@deepseek-ai/dsh-host-webserver',
    '@deepseek-ai/dsh-settings',
    '@deepseek-ai/dsh-system-prompt',
    '@deepseek-ai/dsh-tools',
  ],
})
