/**
 * Managed-block handling for the profile cordis.patch.yml plus the derived
 * opt-in posture. This is the single source of truth shared by the card's
 * host half and the maintenance CLI: enabling better-session means this
 * marker-delimited block exists in the profile layer, disabling means it is
 * gone. The official hot-reload chain re-reads these user-layer rows without
 * a restart.
 * @module better-session-manager/core/profile-blocks
 */
import { existsSync, readFileSync } from 'node:fs'

export const BLOCK_BEGIN = '# >>> better-session opt-in (managed by dsh-better-session-manager) >>>'
export const BLOCK_END = '# <<< better-session opt-in <<<'

/** Insert rows the aggregate ships disabled; the enable block flips them back on. */
export const MANAGED_INSERT_IDS = ['web-ui-session-branch', 'web-ui-session-rdb', 'web-ui-conversation-message-actions'] as const
/** The stock persistence row: disabled permanently while opted in (the RDB backend replaces it). */
export const HARNESS_ROW_ID = 'session-persistence-jsonl'
/** Every artifact the aggregate emits for the inactive external. */
export const OVERRIDE_TARGET_IDS = [HARNESS_ROW_ID, ...MANAGED_INSERT_IDS] as const

export const ENABLE_BLOCK_BODY = [
  `- id: ${HARNESS_ROW_ID}`,
  '  disabled: true',
  ...MANAGED_INSERT_IDS.flatMap((id) => [`- id: ${id}`, '  disabled: false']),
]

function renderEnableBlock(): string {
  return [
    BLOCK_BEGIN,
    '# Re-enables the three better-session insert rows and keeps the stock',
    '# jsonl persistence row disabled: while opted in, the RDB (SQLite)',
    '# backend owns session storage. Hot-applied on long-lived surfaces.',
    ...ENABLE_BLOCK_BODY,
    BLOCK_END,
  ].join('\n')
}

/**
 * Insert/replace (`insert`) or remove (`remove`) the managed block.
 * Idempotent in both directions; removing without a block returns the text
 * untouched.
 */
export function applyManagedBlock(patchText: string, mode: 'insert' | 'remove'): string {
  const beginIdx = patchText.indexOf(BLOCK_BEGIN)
  const endIdx = beginIdx >= 0 ? patchText.indexOf(BLOCK_END, beginIdx) : -1
  if (mode === 'remove') {
    if (beginIdx < 0) return patchText
    const after = endIdx >= 0 ? patchText.slice(endIdx + BLOCK_END.length) : ''
    const prefix = patchText.slice(0, beginIdx).replace(/\n+$/, '\n')
    const tail = after.replace(/^\n+/, '').replace(/\s*$/, '')
    return prefix + (tail ? tail + '\n' : '')
  }
  const block = renderEnableBlock()
  if (beginIdx >= 0 && endIdx >= 0) {
    return patchText.slice(0, beginIdx) + block + patchText.slice(endIdx + BLOCK_END.length)
  }
  const base = patchText.replace(/\n*$/, '\n')
  return base + '\n' + block + '\n'
}

/** Whether an exact `- id: <row>` line is followed by `disabled: true` anywhere in the text. */
export function hasDisabledOverride(lines: readonly string[], id: string): boolean {
  return lines.some((line, i) => line === `- id: ${id}` && lines[i + 1] === '  disabled: true')
}

export interface MountState {
  state: 'inactive-by-default' | 'enabled-via-profile' | 'enabled-via-bundle' | 'not-installed'
  /** True when the aggregate artifact disables every better-session artifact (shipped default). */
  repoOverridden: boolean
  /** True when the live profile carries our managed enable block. */
  profileEnabledBlock: boolean
}

/**
 * Derive where the opt-in stands from the two layered surfaces:
 * - aggregate artifact (repo generated file): are all four artifacts overridden?
 * - live profile file: does the managed enable block exist?
 * Manual edits that flip rows without our markers read as `enabled-via-bundle`
 * when the aggregate itself no longer overrides (future churn guard).
 */
export function deriveMountState(repoPatchText: string | undefined, profilePatchText: string | undefined): MountState {
  // An empty artifact text behaves like an absent one: nothing of this
  // external exists in that layer yet.
  const repoLines = ((repoPatchText !== undefined && repoPatchText.trim() !== '') ? repoPatchText : undefined)?.split(/\r?\n/)
  const profileText = profilePatchText ?? ''
  // Post-fix inactive rendering ships exactly three disabled insert rows and
  // NO harness patch rows; that combination is the "shipped inactive" mark.
  const repoOverridden = repoLines !== undefined && MANAGED_INSERT_IDS.every((id) => hasDisabledOverride(repoLines, id))
  const profileEnabledBlock = profileText.includes(BLOCK_BEGIN)
  let state: MountState['state']
  if (profileEnabledBlock) state = 'enabled-via-profile'
  else if (repoOverridden) state = 'inactive-by-default'
  else if (repoLines === undefined) state = 'not-installed'
  else state = 'enabled-via-bundle'
  return { state, repoOverridden, profileEnabledBlock }
}

/** Convenience used by hosts with direct file access (the CLI passes texts directly). */
export function readMountState(repoPatchPath: string, profilePatchPath: string): MountState & { repoPatchPath: string; profilePatchPath: string } {
  const repoText = existsSync(repoPatchPath) ? readFileSync(repoPatchPath, 'utf8') : undefined
  const profileText = existsSync(profilePatchPath) ? readFileSync(profilePatchPath, 'utf8') : undefined
  return { ...deriveMountState(repoText, profileText), repoPatchPath, profilePatchPath }
}
