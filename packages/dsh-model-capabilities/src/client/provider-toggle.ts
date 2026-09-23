/**
 * Provider disable/enable orchestration over the remote settings wire.
 *
 * Disable = stash the user-layer profile in this plugin's own settings entry,
 * then unset `providers.<route>` in the pi-ai namespace (the official
 * Remove-provider seam): the route unregisters and the provider leaves the
 * model catalog that both the composer picker and the subagent selection read.
 * Enable restores the archived profile and clears the archive entry. Both
 * entries are revision-fenced; orderings keep the worst case a harmless
 * duplicate archive.
 * @module @linxin666/dsh-client-ui-model-capabilities/client/provider-toggle
 */

import type { RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-settings/types'
import {
  buildRestoreProviderOp,
  buildStashOp,
  buildUnsetProviderOp,
  buildUnstashOp,
  hasNonUserProfile,
  hasProfileAt,
  readDisabledStore,
  resolveArchiveEntry,
  type StashedProvider,
} from '../core/provider-toggle.ts'
import { readAt } from '../core/capabilities.ts'
import type { SettingsNamespaceFace } from './settings-face.ts'

/** What one toggle attempt ended in. */
export type ToggleOutcome =
  | { kind: 'ok' }
  /** A namespace moved past its read revision; the caller reloads and retries. */
  | { kind: 'conflict', ns: string }
  | { kind: 'refused', message: string }
  /** The pi-ai user layer holds no profile for the route (nothing to take down). */
  | { kind: 'no-profile' }
  /** Another layer (the composition base) holds the route, so the unset cannot take it down. */
  | { kind: 'base-profile' }
  /** The route already has a profile; restoring the archive would clobber it. */
  | { kind: 'route-exists' }
  | { kind: 'no-stash' }
  /** A needed entry is not served on this host. */
  | { kind: 'unavailable' }
  /** The route is enabled again, but clearing the archive entry failed. */
  | { kind: 'partial', message: string }

function refused(error: RemoteFailure): ToggleOutcome {
  return { kind: 'refused', message: typeof error.message === 'string' && error.message.length > 0 ? error.message : error.code }
}

function failureOf(ns: string, error: RemoteFailure): ToggleOutcome {
  return error.code === 'settings/conflict' ? { kind: 'conflict', ns } : refused(error)
}

function viewOf(namespaces: readonly SettingsNamespaceView[], ns: string): SettingsNamespaceView | undefined {
  return namespaces.find(candidate => candidate.ns === ns)
}

function profileAt(userSection: unknown, route: string): Record<string, unknown> | undefined {
  const profile = readAt(userSection, ['providers', route])
  return typeof profile === 'object' && profile !== null && !Array.isArray(profile)
    ? profile as Record<string, unknown>
    : undefined
}

/**
 * Take one provider down: archive its user-layer profile, then unset the
 * profile so the route unregisters.
 * @param face - the settings namespace face.
 * @param llmNs - the pi-ai namespace the provider is declared in.
 * @param route - provider route id.
 * @param displayName - display name for the archive listing, when known.
 */
export async function disableProvider(
  face: SettingsNamespaceFace,
  llmNs: string,
  route: string,
  displayName: string | undefined,
): Promise<ToggleOutcome> {
  const described = await face.describe()
  if (!described.ok) return refused(described.error)
  const llmView = viewOf(described.value.namespaces, llmNs)
  const archive = resolveArchiveEntry(described.value.namespaces)
  if (llmView === undefined || archive === undefined) return { kind: 'unavailable' }
  const profile = profileAt(llmView.user, route)
  if (profile === undefined) return { kind: 'no-profile' }
  // A route the composition also declares would survive the unset: refuse
  // rather than report a disable that did not take the provider down.
  if (hasNonUserProfile(llmView, route)) return { kind: 'base-profile' }
  const stash: StashedProvider = { profile, ...(displayName !== undefined ? { displayName } : {}) }
  const stashed = await face.mutate(archive.entryId, [buildStashOp(route, stash)], archive.view.revision)
  if (!stashed.ok) return failureOf(archive.entryId, stashed.error)
  const taken = await face.mutate(llmNs, [buildUnsetProviderOp(route)], llmView.revision)
  if (!taken.ok) return failureOf(llmNs, taken.error)
  return { kind: 'ok' }
}

/**
 * Bring one provider back: restore the archived profile verbatim, then clear
 * the archive entry. Refuses when the route has grown a new profile in the
 * meantime, so an enable can never clobber newer configuration.
 * @param face - the settings namespace face.
 * @param llmNs - the pi-ai namespace the provider is declared in.
 * @param route - provider route id.
 */
export async function enableProvider(
  face: SettingsNamespaceFace,
  llmNs: string,
  route: string,
): Promise<ToggleOutcome> {
  const described = await face.describe()
  if (!described.ok) return refused(described.error)
  const llmView = viewOf(described.value.namespaces, llmNs)
  const archive = resolveArchiveEntry(described.value.namespaces)
  if (llmView === undefined || archive === undefined) return { kind: 'unavailable' }
  if (hasProfileAt(llmView.user, route)) return { kind: 'route-exists' }
  const stash = readDisabledStore(archive.view.value)[route]
  if (stash === undefined) return { kind: 'no-stash' }
  const restored = await face.mutate(llmNs, [buildRestoreProviderOp(route, stash.profile)], llmView.revision)
  if (!restored.ok) return failureOf(llmNs, restored.error)
  const cleared = await face.mutate(archive.entryId, [buildUnstashOp(route)], archive.view.revision)
  if (!cleared.ok) return { kind: 'partial', message: cleared.error.message }
  return { kind: 'ok' }
}
