/**
 * Sidebar footer-seat wrapper for the remote-control entry.
 *
 * Current dsh web shells declare `sidebar.footer.action` (the seat beside the
 * settings trigger) instead of the legacy `sidebar.remote` seat this plugin
 * was written against. The footer seat supplies `{ wide }` but not the
 * `useWorkspaces` projection hook, so this wrapper substitutes a
 * workspace-agnostic selector: pairing without a deep-linked workspace is
 * fully supported by the host `/api/pair` routes.
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { RemoteEntry } from './RemoteEntry.tsx'

/** Entry props: the footer seat's column state + the standard locale seat. */
export type FooterRemoteEntryProps = PropsLocale<'remote'> & { wide: boolean }

/**
 * Render the remote-control trigger + pairing panel from the footer seat.
 * @param props - composed slot props (footer seat subset).
 * @returns the entry element tree.
 */
export function FooterRemoteEntry(props: FooterRemoteEntryProps) {
  return (
    <RemoteEntry
      wide={props.wide}
      useWorkspaces={() => undefined as never}
      useSessions={() => undefined as never}
      t={props.t}
    />
  )
}
