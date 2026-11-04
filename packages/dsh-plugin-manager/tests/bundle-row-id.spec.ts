/**
 * This package's own bundle row.
 *
 * Loader row ids live in ONE global id space: the loader keeps a single entry
 * per id, later wins, and a shared id produces no diagnostic (issue #1794).
 * This package therefore has two invariants to keep, and both are silent
 * failures when they break, so they are pinned here against the shipped files:
 *
 * 1. the row's `name` is exactly the package name. The official
 *    `@deepseek-ai/dsh-client-modules` mounts a package's browser half on the
 *    loader row whose specifier resolves to that package's own manifest, so the
 *    aggregate's subpath-shaped name (`@linxin666/dsh-web-all/plugin-manager`)
 *    would mount the host half only and leave the update-check section dead;
 * 2. the row's `id` is claimed by nobody else: not an official DSH bundle row
 *    (the roster below, snapshotted from the installed
 *    `@deepseek-ai/dsh-web-app` at the 0.2.2-alpha.3 cohort) and not another
 *    family package. Reusing the official `ui-plugin-manager` id dropped the
 *    official row, and because only the official client registers
 *    `sidebar.panellist`, the sidebar "Plugins" entry and the whole plugin
 *    management page disappeared without a log line.
 *
 * The official roster is a snapshot, not a live read: this repository builds
 * against published SDK packages and has no dependency on the Host's bundle
 * tree. Refresh it from the installed official patches, and only after checking
 * that no family row sits under an id DSH added:
 *
 * ```sh
 * rg -o 'id:\s*\S+' ~/.dsh/profiles/node_modules/@deepseek-ai/{dsh-base,dsh-web-app}/cordis.patch.yml | sort -u
 * ```
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { claimedIdsOf, insertRowsOf } from '../src/host/rows.ts'
import { name as hostPluginName } from '../src/index.ts'

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES_DIR = resolve(PACKAGE_DIR, '..')
const PACKAGE_NAME = '@linxin666/dsh-client-ui-plugin-manager'

/** The text of this package's own bundle patch, as the loader reads it. */
const bundlePatch = (): string => readFileSync(join(PACKAGE_DIR, 'cordis.patch.yml'), 'utf8')

/**
 * Row ids claimed by every family package's bundle patch, keyed by the package
 * directory that claims them. The aggregate's generated rows are included: it
 * is the other writer in the same id space.
 * @returns package directory to claimed ids.
 */
function familyClaimedIds(): Map<string, string[]> {
  const claimed = new Map<string, string[]>()
  for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const patch = join(PACKAGES_DIR, entry.name, 'cordis.patch.yml')
    try {
      claimed.set(entry.name, claimedIdsOf(readFileSync(patch, 'utf8')))
    } catch {
      // A package without a bundle patch claims nothing.
    }
  }
  return claimed
}

/**
 * Row ids the official DSH bundles already claim, snapshotted from the
 * installed `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app` bundle
 * patches (cohort 0.2.2-alpha.3, both bundles: the official id space is not
 * only `ui-*` — `dsh-base` claims a bare `plugin-manager`, which is why this
 * package's own id could not simply drop the prefix). A family row must stay
 * out of this set: the loader cannot mount two packages under one id and
 * never says so. The plugin-management rows are asserted present below so
 * the snapshot cannot be emptied to make the check pass.
 */
const OFFICIAL_ROW_IDS: ReadonlySet<string> = new Set([
  'account-controller', 'agent', 'agent-default-model', 'agent-instructions', 'agent-loop',
  'agent-preset-registry', 'api-remotes', 'approval', 'attachment-local', 'authorization',
  'bash-sandbox', 'client-hmr', 'command-compact', 'command-feedback', 'command-goal',
  'commands', 'compaction-basic', 'config-editor', 'connection', 'cordis-client-runner',
  'cordis-host-runner', 'cordis-inspect-providers', 'credentials', 'deepseek-account',
  'deepseek-llm-api-extensions', 'deliverable-file-references', 'desktop-product-telemetry',
  'directory-picker', 'entry-customization', 'file-reference-local', 'file-upload',
  'fs-observation-policy', 'fs-sandbox', 'goal', 'goal-round-driver', 'harness-dev-context',
  'hmr', 'image-offload', 'job-controller', 'jobs', 'llm', 'llm-deepseek',
  'llm-deepseek-account', 'llm-pi-ai', 'llm-retry', 'locale', 'mcp-resources',
  'message-feedback', 'message-quotes', 'modules', 'office-to-pdf', 'open-in-app', 'otel',
  'permission', 'plan-mode', 'plugin-inventory', 'plugin-manager',
  'plugin-package-inventory-deepseek', 'product-analytics', 'ptc-runtime', 'pwsh-sandbox',
  'remote-access', 'repeat-tool-reminder', 'resources', 'sandbox', 'sandbox-policy', 'schedule',
  'session', 'session-checkpoint-policy', 'session-controller', 'session-log-deepseek',
  'session-log-download', 'session-persistence-jsonl', 'session-projection',
  'session-projection-cache', 'session-query-sqlite', 'session-reference', 'session-stats',
  'session-telemetry-otel', 'session-title', 'session-title-llm', 'session-turn-outline',
  'settings', 'settings-controller', 'shell-env', 'shortcuts', 'skill', 'skill-filesystem',
  'spill-local', 'spill-policy', 'storage', 'storage-domain', 'storage-json', 'subagent',
  'subagent-fork-in-process', 'subagent-model-selection-settings', 'subagent-spawn-in-process',
  'subprocess', 'system-prompt', 'terminal-controller', 'timeout-policy', 'timer',
  'token-meter', 'tool-bash', 'tool-executor-native', 'tool-executor-ptc', 'tool-fs',
  'tool-fs-search', 'tool-goal', 'tool-jobs', 'tool-plugin-manager', 'tool-pwsh',
  'tool-result-pruner', 'tool-skill', 'tool-subagent', 'tool-subagent-control',
  'tool-subagent-fork', 'tool-todo', 'tool-web', 'tool-workflow', 'tool-working-directory',
  'tools', 'typert', 'typert-gateway', 'typert-loader', 'ui-agent-preset', 'ui-approval',
  'ui-attachment', 'ui-brand-official', 'ui-chat', 'ui-commands', 'ui-context-menu',
  'ui-conversation', 'ui-cordis', 'ui-deliverables', 'ui-file-actions', 'ui-file-drag',
  'ui-goal', 'ui-input-trigger', 'ui-jobs', 'ui-layout', 'ui-message-feedback',
  'ui-model-selection', 'ui-open-in-app', 'ui-permission', 'ui-plan', 'ui-plugin-manager',
  'ui-reference', 'ui-renderer', 'ui-schedule', 'ui-secret-mask', 'ui-session', 'ui-settings',
  'ui-settings-account', 'ui-settings-agent-loop', 'ui-settings-general', 'ui-settings-models',
  'ui-settings-plugin-inventory', 'ui-settings-plugins', 'ui-settings-session-log',
  'ui-settings-shell', 'ui-settings-subagent', 'ui-settings-web-search', 'ui-shortcuts',
  'ui-sidebar', 'ui-sidebar-browser', 'ui-sidebar-documentpreview', 'ui-sidebar-files',
  'ui-sidebar-right', 'ui-sidebar-terminal', 'ui-skill', 'ui-subagent', 'ui-theme', 'ui-tool',
  'ui-trajectory', 'ui-user-questions', 'ui-workflow-run', 'ui-workspace', 'user-questions',
  'web', 'web-deepseek-api', 'web-fetch-http', 'web-runtime', 'web-search-deepseek',
  'web-startup', 'webserver', 'workflow-ptc', 'working-directory', 'workspace',
  'workspace-changes', 'workspace-controller', 'workspace-files',
])

describe('this package\'s bundle row', () => {
  it('user installing this package gets one loader row named after the package', () => {
    // Given the bundle patch the loader composes for a standalone install,
    const rows = insertRowsOf(bundlePatch())
    // When the insert entries are read, one row mounts this package,
    expect(rows).toHaveLength(1)
    // Then under the exact package name, which is what the official client
    // module host resolves a browser half by.
    expect(rows[0]?.name).toBe(PACKAGE_NAME)
  })

  it('user booting a profile keeps the official Plugins entry, because this row claims no official id', () => {
    // Given the row id this package claims,
    const [id] = claimedIdsOf(bundlePatch())
    // When it is checked against the official bundle rows, whose owner is the
    // only half registering the sidebar Plugins panel,
    expect(OFFICIAL_ROW_IDS.has(id ?? '')).toBe(false)
    expect(OFFICIAL_ROW_IDS.has('ui-plugin-manager')).toBe(true)
    expect(OFFICIAL_ROW_IDS.has('ui-settings-plugin-inventory')).toBe(true)
    // Then the shipped id is its own, distinguishable namespace.
    expect(id).not.toBe('ui-plugin-manager')
  })

  it('user installing a second family package keeps this row mounted', () => {
    // Given every family package's own bundle patch,
    const claimed = familyClaimedIds()
    const [id] = claimedIdsOf(bundlePatch())
    // When each package's claimed ids are compared with this package's id,
    const alsoClaiming = [...claimed]
      .filter(([dir, ids]) => dir !== 'dsh-plugin-manager' && ids.includes(id ?? ''))
      .map(([dir]) => dir)
    // Then nobody else claims it, so no second package can drop this row.
    expect(alsoClaiming).toEqual([])
    expect(claimed.get('dsh-plugin-manager')).toEqual([id])
  })

  it('operator reading a mounted entry sees the host half under the row it declares', () => {
    // Given the cordis plugin name the host half exports,
    const exported = hostPluginName
    // When the operator maps profile entry ids back to mounted plugins,
    const [id] = claimedIdsOf(bundlePatch())
    // Then the two agree, so a mounted row is never ambiguous between two
    // host halves sharing one cordis name.
    expect(exported).toBe(id)
  })
})
