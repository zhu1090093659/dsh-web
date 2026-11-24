/**
 * Protocol v1 pairing panel — browser half. Registers the `remote-bridge`
 * dictionary and the sidebar-foot trigger (into the ui-sidebar-declared
 * `sidebar.footer.action` list slot) that opens the panel showing this
 * package's own one-shot bootstrap token as a QR symbol plus its plaintext.
 *
 * The panel is display-only for the native path: it reads the same loopback-only
 * `GET /remote-bridge/pair/token` route an operator would curl, and never spends
 * the token (`pair.begin` stays the phone's call). The browser half therefore
 * adds no wire surface — the envelope, the method names, the topic names and
 * the events are untouched — and it does not touch `dsh-remote-web-ui`'s pairing
 * service, its roster, or its browser cookie path.
 *
 * The half also draws the transcript side of §35.11: one keyed `tool.call.toolview`
 * entry renders a `ui_present` call's whole page in a controlled frame, while the
 * phone stays the only place an action can be answered.
 *
 * Export discipline (packages/AGENTS.md): the /client surface carries only what
 * cordis loading needs plus types.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale) and its
// LocaleNamespaceMap merge table.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.slots merge (the renderer owns the slot registry).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ui-sidebar SlotMap merge (the 'sidebar.footer.action' hole).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the official remote-connection SlotMap merge ('settings.remoteConnection.extensions').
import type {} from '@deepseek-ai/dsh-client-remote-connection/client'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { PairEntry } from './PairEntry.tsx'
import { RemoteConnectionExtension } from './RemoteConnectionExtension.tsx'
import { readPairToken } from './pair-token.ts'
import { registerPresentToolview } from './toolview-slot.ts'
import { en, zh, type RemoteBridgeKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Protocol v1 pairing panel copy. */
    'remote-bridge': RemoteBridgeKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'remote-bridge'

/** Unique occupant id inside the shared footer.action list slot. */
const ENTRY_ID = 'remote-bridge'

/** Services required by this plugin. */
export const inject = ['slots', 'locale']

/**
 * Register the protocol v1 pairing surface.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'remote-bridge: dictionaries')

  // Sidebar foot entry. The shell declares 'sidebar.footer.action' (list kind:
  // multiple occupants may share the seat) and registration is
  // declaration-aware via slots.inject. Read and clipboard arrive as an
  // injected face rather than a module import, which keeps the trigger's
  // rendered tree free of closure-factory bundles.
  ctx.slots.inject('sidebar.footer.action', () => {
    try {
      return ctx.slots.register({
        name: 'sidebar.footer.action',
        id: ENTRY_ID,
        locale: NS,
        inject: () => ({ read: readPairToken, copy: writeClipboard }),
      }, PairEntry)
    } catch {
      return () => {}
    }
  })

  // Official Settings -> Remote Connection extension seat (DSH 0.2.3-alpha.2+):
  // surface native iOS App pairing beneath the official browser remote access cards.
  ctx.slots.inject('settings.remoteConnection.extensions', () => {
    try {
      return ctx.slots.register({
        name: 'settings.remoteConnection.extensions',
        id: `${ENTRY_ID}-ios`,
        order: 20,
        locale: NS,
        inject: () => ({ read: readPairToken, copy: writeClipboard }),
      }, RemoteConnectionExtension)
    } catch {
      return () => {}
    }
  })

  // The transcript card of an interactive presentation (§35.11): one keyed
  // registration under the wire Tool name draws the body of a `ui_present` call,
  // so the official Tool row keeps everything else — identity, timing and the
  // dispatch tree — and no Chat Node renderer is shadowed.
  registerPresentToolview(ctx, NS)
}

export type { PairEntryProps } from './PairEntry.tsx'
export type { RemoteConnectionExtensionCardProps } from './RemoteConnectionExtension.tsx'
export type { PairCopyState, PairPanelProps, PairPanelState } from './PairPanel.tsx'
export type { PairTokenFetch, PairTokenOutcome, PairTokenResponse, ReadPairTokenOptions } from './pair-token.ts'
export type { RemoteBridgeKey } from './locales.ts'
