/**
 * AionUI right-panel system — browser half: mounts the explorer and preview
 * columns into the web shell's frame grid (through the layout controller),
 * binds the four stores to the live client runtime (the active session's cwd
 * is the project root), subscribes to the host change stream (fs + git), and
 * follows the shell's dark marker (body[data-ds-dark-theme]) via CSS only.
 *
 * Failure policy: every DOM/runtime wiring failure is logged, never thrown —
 * the web shell fails the whole boot when a plugin apply throws.
 *
 * AionUi right-panel design (Apache-2.0, iOfficeAI/AionUi) — re-implemented
 * from measured behavior and architecture, not copied code.
 * @module dsh-aionui-panel/client
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input dock entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { PanelApi, subscribePanelEvents } from './api.ts'
import { PanelLayoutController } from './layout.ts'
import { createPanelStores, layoutSetRoot } from './store.ts'
import { mountPanels } from './mount.tsx'
import { NS, dictionaries, setLanguage, type AionUiPanelKey } from './locales.ts'
import { DragFileInlay, type DragFileInjected } from './drag/DragFileInlay.tsx'
import { insertPathIntoDraft } from './drag/file-drag.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Panel surface copy. */
    'aionui-panel': AionUiPanelKey
  }
}

/** Required services: sessions for the project root, locale for the copy. */
export const inject = ['sessions', 'locale']

/** Apply the browser half. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-aionui-panel: dictionaries')

  // The composer drop target for explorer file drags: mounted in the
  // official `conversation.input.dock` band (declared by the shipped
  // ui-conversation rc.6 shell), session-routed through the conversation
  // input facade. A missing session scope or conversation service degrades
  // to no-op — the panels themselves never depend on the dock entry.
  ctx.inject(['slots', 'conversation', 'sessions'], (scope: ClientContext) => {
    const sessions = scope.sessions
    const conversation = scope.conversation
    scope.slots.inject('conversation.input.dock', () =>
      scope.slots.register({
        name: 'conversation.input.dock',
        id: 'aionui-drag-file',
        order: 90,
        locale: NS,
        inject: (sessionId: SessionId | undefined): DragFileInjected => ({
          insertPath: (path: string): boolean => {
            if (sessionId === undefined) return false
            const actx = sessions.scope(sessionId)
            if (actx === undefined) return false
            const input = conversation.input
            if (input === undefined) return false
            const shell = input.for(actx)
            const draft = shell.state.getSnapshot().draft
            shell.setDraft(insertPathIntoDraft(draft, path))
            return true
          },
        }),
      }, DragFileInlay))
  })

  ctx.effect(() => {
    const api = new PanelApi()
    const stores = createPanelStores(api)
    const layout = new PanelLayoutController(stores.layout)
    const disposers: Array<() => void> = []
    let disposeEvents: (() => void) | undefined
    let currentRoot = ''
    let lastPreviewOpen = false

    // The project root follows the active session's cwd; switching sessions
    // re-binds every store (widths, collapse, tree, tabs persist per root).
    const bindRoot = (): void => {
      const snapshot = ctx.sessions.list.getSnapshot()
      const sessionId = snapshot.current as SessionId | undefined
      const cwd = sessionId === undefined ? undefined : snapshot.byId[sessionId]?.cwd
      const root = typeof cwd === 'string' && cwd !== '' ? cwd : ''
      if (root === currentRoot) return
      currentRoot = root

      disposeEvents?.()
      disposeEvents = undefined
      const previewOpen = stores.preview.getSnapshot().open
      lastPreviewOpen = previewOpen
      layoutSetRoot(stores.layout, root, previewOpen)
      stores.explorer.setRoot(root)
      stores.scm.setRoot(root)
      stores.preview.setRoot(root)

      if (root === '') return
      disposeEvents = subscribePanelEvents(root, (event) => {
        if (event.kind === 'fs') {
          void stores.explorer.handleFsChange()
          void stores.preview.handleFsChange()
        }
        if (event.kind === 'git') {
          // The host status is the only truth; land it directly.
          stores.scm.update((prev) => (prev.root !== root ? prev : { ...prev, status: event.status, loading: false }))
          // The index/worktree moved: every open diff tab is stale by now.
          void stores.preview.handleGitChange(root)
        }
      })
    }
    disposers.push(ctx.sessions.list.subscribe(bindRoot))
    bindRoot()

    // Mirror the preview open state into the layout store (single source: the
    // preview store), and play the enter animation when the region opens.
    const mirrorPreviewOpen = (): void => {
      const open = stores.preview.getSnapshot().open
      if (open === lastPreviewOpen) return
      lastPreviewOpen = open
      stores.layout.update((prev) => ({ ...prev, previewOpen: open }))
      if (open) {
        const col = document.querySelector<HTMLElement>('[data-aionui-preview-col]')
        col?.classList.add('aionui-preview-enter')
        setTimeout(() => col?.classList.remove('aionui-preview-enter'), 300)
      }
    }
    disposers.push(stores.preview.subscribe(mirrorPreviewOpen))

    // Language mirroring (the shell owns <html lang>; the dictionary follows).
    let langObserver: MutationObserver | undefined
    const syncLanguage = (): void => {
      setLanguage(document.documentElement.lang?.startsWith('zh') ? 'zh' : 'en')
    }
    langObserver = new MutationObserver(syncLanguage)
    langObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
    syncLanguage()

    // Mount everything. DOM failures degrade the panels, never the GUI.
    try {
      layout.mount()
      mountPanels(stores, () => layout.toggleExplorer())
    } catch (error) {
      console.error('[dsh-aionui-panel] mount failed:', error)
    }

    // Debounced persists (explorer/scm/preview) may be pending when the page
    // hides; flush them so a close/background never drops the last 150ms.
    const flushOnHide = (): void => stores.flushNow()
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') flushOnHide()
    }
    window.addEventListener('pagehide', flushOnHide)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      flushOnHide()
      window.removeEventListener('pagehide', flushOnHide)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      disposeEvents?.()
      langObserver?.disconnect()
      for (const dispose of disposers) dispose()
      layout.dispose()
    }
  }, 'dsh-aionui-panel: wiring')
}
