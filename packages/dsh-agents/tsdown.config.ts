/**
 * Standalone tsdown config for the dsh-agents plugin.
 *
 * The package ships both halves: the node-half library from src/index.ts and the
 * browser bundle lib/client.js from src/client/index.ts (closure-factory artifact
 * for the GUI's __ModuleLoader__, CSS Modules inlined with an auto-injected style
 * tag). Both come from the repository's shared client-bundle preset, imported
 * rather than copied, per packages/AGENTS.md.
 *
 * libExternal carries the `@deepseek-ai/*` packages the node half imports at
 * runtime; the browser half resolves its own externals through the preset's
 * platform seed table, so the client packages it imports type-only need no
 * entry here (the compiler erases them).
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@linxin666/dsh-agents', ['src/index.ts'], {
  libExternal: [
    '@deepseek-ai/dsh-agent',
    '@deepseek-ai/dsh-api-gateway',
    '@deepseek-ai/dsh-host-webserver',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-subagent',
    '@deepseek-ai/dsh-system-prompt',
    '@deepseek-ai/dsh-tools',
    '@deepseek-ai/dsh-workspace',
  ],
})
