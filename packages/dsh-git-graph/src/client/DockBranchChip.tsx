/**
 * Dock-band fallback seat for the git branch chip.
 *
 * Current dsh web shells declare `conversation.input.dock` (the composer dock
 * band, a list slot) instead of the legacy `conversation.input.selector.context`
 * hole this plugin was written against. The dock band's owner props carry
 * `sessionId` but not the legacy seat's `subscribeChanges` channel; session
 * switches still re-key the chip through the `sessionId` prop, so the fallback
 * is a pure props re-cast.
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { BranchChip, type BranchChipProps } from './chips/BranchChip.tsx'
import type { GitGraphInjected } from './index.ts'

/** Composed props of the dock-band fallback seat. */
export type DockBranchChipProps = PropsRuntime<'conversation.input.dock'> & GitGraphInjected & PropsLocale<'git-graph'>

/**
 * Render the branch chip from the composer dock band.
 * @param props - composed slot props (dock band seat).
 * @returns the branch chip element tree.
 */
export function DockBranchChip(props: DockBranchChipProps) {
  return <BranchChip {...(props as unknown as BranchChipProps)} />
}
