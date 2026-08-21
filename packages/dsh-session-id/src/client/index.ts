/**
 * Session-id plugin — browser half. Registers the `session-id` dictionaries
 * and the sidebar-foot trigger (into the ui-sidebar-declared
 * `sidebar.footer.action` list slot) that opens the session-id panel. The
 * panel lists every session with its full id and a copy button.
 *
 * Export discipline (packages/AGENTS.md): the /client surface carries only
 * what cordis loading needs plus types.
 */
import type { ClientContext, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale) and its
// LocaleNamespaceMap merge table.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ui-sidebar SlotMap merge (the 'sidebar.footer.action' hole).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { SessionIdEntry } from './SessionIdEntry.tsx'
import { en, zh, type SessionIdKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Session-id surface copy. */
    'session-id': SessionIdKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'session-id'

/** Unique occupant id inside the shared footer.action list slot. */
const ENTRY_ID = 'session-id'

/** Services required by this plugin. */
export const inject = ['slots', 'locale', 'sessions']

/**
 * Register the session-id surface.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-id: dictionaries')

  // Sidebar foot entry. The shell declares 'sidebar.footer.action' (list kind:
  // multiple occupants may share the seat); registration is declaration-aware
  // via slots.inject. The list read face (ctx.sessions.list) is injected as a
  // plain prop so the component can subscribe without per-session wiring.
  ctx.slots.inject('sidebar.footer.action', () => {
    // Read the browser sessions face explicitly (combined host/client program
    // shares the Cordis Context name; the explicit face keeps types correct).
    const sessions = ctx.get('sessions') as unknown as ISessions
    const list = {
      getSnapshot: () => sessions.list.getSnapshot(),
      subscribe: (fn: () => void) => sessions.list.subscribe(fn),
    }
    return ctx.slots.register({
      name: 'sidebar.footer.action',
      id: ENTRY_ID,
      locale: NS,
      inject: () => ({ list }),
    }, SessionIdEntry)
  })
}

export type { SessionIdEntryProps } from './SessionIdEntry.tsx'
export type { SessionIdKey } from './locales.ts'
export type { SessionListReadSource, SessionIdPanelProps } from './SessionIdPanel.tsx'
