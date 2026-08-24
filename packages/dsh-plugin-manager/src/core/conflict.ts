/**
 * Conflict-ledger diffing. The official host applies structural conflict
 * rules at install time (disableControlsOnInstall: installing the dsh-web
 * family disables the built-in web-ui product rows so the two never
 * double-mount), but no UI surfaces what the rules just did. This module
 * diffs the plugin-control snapshots taken before and after an install and
 * classifies every state change so the tab can render it as a reversible,
 * attributable conflict notice.
 *
 * The install-time authority ends here: duplicate insert-id claims between
 * two user plugins carry no at-install signal through the RPC channels (the
 * Loader only re-reads the composition at the next start), so that failure
 * shape is left to the boot-failure ring — the real start is the authoritative
 * conflict detector.
 * @module @linxin666/dsh-client-ui-plugin-manager/core
 */

import type { PluginControlItem } from './protocol.ts'

/** One observed product-control state change between two snapshots. */
export interface ControlChange {
  id: string
  name: string
  from: PluginControlItem['state']
  to: PluginControlItem['state']
}

/** Meaningful change kinds a conflict notice distinguishes. */
export type ControlChangeKind = 'rule-disabled' | 'rule-enabled' | 'state-change'

/**
 * Diff two plugin-control snapshots by id. Only entries present in both
 * snapshots with a changed state are reported; entries appearing or
 * disappearing are ordinary install/uninstall outcomes, not conflicts.
 * @param before - snapshot taken before the install.
 * @param after - snapshot taken after the install.
 * @returns one change per id whose state moved, in id order.
 */
export function diffControls(before: readonly PluginControlItem[], after: readonly PluginControlItem[]): ControlChange[] {
  const afterById = new Map(after.map(item => [item.id, item]))
  const changes: ControlChange[] = []
  for (const item of before) {
    const current = afterById.get(item.id)
    if (current === undefined || current.state === item.state) continue
    changes.push({ id: item.id, name: item.name, from: item.state, to: current.state })
  }
  return changes
}

/**
 * Classify one control-state change for messaging. A change into `disabled`
 * is the conflict rule's action (reversible by re-enabling); a change out of
 * `disabled` is a manual undo; anything else is reported neutrally.
 * @param change - one diff entry.
 * @returns the message kind.
 */
export function classifyChange(change: ControlChange): ControlChangeKind {
  if (change.to === 'disabled') return 'rule-disabled'
  if (change.from === 'disabled') return 'rule-enabled'
  return 'state-change'
}
