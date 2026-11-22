/**
 * Which update rows the list-level toolbar may act on. Pure, shared by the
 * browser half (the toolbar) and its tests: the host answers with every
 * installed package whose registry source serves a newer release, and the
 * policy of what may be updated in bulk lives here rather than in the host,
 * so the same rows stay available to the per-page update block.
 *
 * Two filters:
 *
 * - **Third-party only.** A package published under the `@deepseek-ai/` scope
 *   ships with DSH itself: its version is chosen by the running installation,
 *   the official page says an upgrade arrives by upgrading DSH, and a
 *   plugin-initiated `pnpm add` of such a package can pull a release the runtime was
 *   never tested against. The bulk action therefore never touches it.
 * - **Compatibility gate.** An update whose manifest declares a DSH minimum the
 *   running host does not satisfy is listed (the user may still upgrade DSH)
 *   but cannot be applied: the host would refuse it with 412 anyway.
 * @module @linxin666/dsh-client-ui-plugin-manager/core
 */

import type { PluginUpdateItem } from './protocol.ts'

/** The npm scope DSH's own packages are published under. */
export const OFFICIAL_SCOPE = '@deepseek-ai/'

/** One exact registry version the user chose not to install. */
export interface IgnoredPluginUpdate {
  id: string
  version: string
}

/** Whether this exact offer is ignored; a newer version does not match. */
export function isUpdateIgnored(item: PluginUpdateItem, ignored: readonly IgnoredPluginUpdate[]): boolean {
  return ignored.some(entry => entry.id === item.id && entry.version === item.latest)
}

/** Rows still offered to the user and to the bulk-update queue. */
export function unignoredUpdates(items: readonly PluginUpdateItem[], ignored: readonly IgnoredPluginUpdate[]): PluginUpdateItem[] {
  return items.filter(item => !isUpdateIgnored(item, ignored))
}

/** Rows currently hidden by an exact-version ignore rule. */
export function ignoredUpdates(items: readonly PluginUpdateItem[], ignored: readonly IgnoredPluginUpdate[]): PluginUpdateItem[] {
  return items.filter(item => isUpdateIgnored(item, ignored))
}

/** Add an idempotent exact-version ignore rule. */
export function withIgnoredUpdate(current: readonly IgnoredPluginUpdate[], item: PluginUpdateItem): IgnoredPluginUpdate[] {
  if (isUpdateIgnored(item, current)) return [...current]
  return [...current, { id: item.id, version: item.latest }]
}

/** Remove this exact offer's ignore rule, leaving other plugins untouched. */
export function withoutIgnoredUpdate(current: readonly IgnoredPluginUpdate[], item: PluginUpdateItem): IgnoredPluginUpdate[] {
  return current.filter(entry => entry.id !== item.id || entry.version !== item.latest)
}

/** Whether a package id is a third-party plugin rather than a DSH-shipped one. */
export function isThirdPartyPlugin(id: string): boolean {
  return !id.startsWith(OFFICIAL_SCOPE)
}

/** The third-party update rows, in host order. */
export function thirdPartyUpdates(items: readonly PluginUpdateItem[]): PluginUpdateItem[] {
  return items.filter(item => isThirdPartyPlugin(item.id))
}

/** Whether the running DSH host satisfies the row's declared minimum. */
export function isUpdateApplicable(item: PluginUpdateItem): boolean {
  return item.compatible !== false
}

/** The third-party rows this runtime can actually apply. */
export function applicableUpdates(items: readonly PluginUpdateItem[]): PluginUpdateItem[] {
  return thirdPartyUpdates(items).filter(isUpdateApplicable)
}
