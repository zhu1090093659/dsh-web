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

import type { ClientContext, SessionId, SettingsScope, SettingsScopeSpec } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the official settings-scope service onto the client Context.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input dock entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { PanelApi, subscribePanelEvents } from './api.ts'
import { AionUiSettingsCard, AionUiSettingsCardController, type AionUiPanelSettings } from './AionUiSettingsCard.tsx'
import { PanelLayoutController } from './layout.ts'
import { createPanelStores, layoutSetRoot } from './store.ts'
import { mountPanels } from './mount.tsx'
import { NS, dictionaries, setLanguage, type AionUiPanelKey } from './locales.ts'
import { DragFileInlay, type DragFileInjected } from './drag/DragFileInlay.tsx'
import { insertPathIntoDraft } from './drag/file-drag.ts'
import { MermaidChatEnhancer } from './chat/mermaid-chat.tsx'
import { handleFileRefClick } from './chat/file-ref.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Panel surface copy. */
    'aionui-panel': AionUiPanelKey
  }

  interface SlotMap {
    /**
     * One family plugin card inside the Web UI Plugins group. Spelled here
     * with the same shape so this package can register without depending on
     * the sibling web-ui-settings package.
     */
    'web-ui.plugin.item': { kind: 'list'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
  }
}

/** Owner share of a plugin card (the section supplies nothing). */
export interface SettingsPluginItemOwnerProps {
  /** Marker field: card owner props are intentionally empty. */
  children?: never
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Optional rc.6 compatibility binder provided by dsh-web-ui-settings;
     * absent when that group plugin is not installed, so callers fall back to
     * the official settings scope.
     */
    webUiSettings?: { bind<S>(spec: SettingsScopeSpec<S>): SettingsScope<S> }
  }
}

/** Required services: sessions for the project root, locale for the copy, and the settings scope for the master switch. */
export const inject = ['sessions', 'locale', 'settingsScope']

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

  // Transcript mermaid enhancement rides the same dock as a zero-render
  // sentinel: the shell has no message-body slot, so the sentinel observes
  // the document for the chat renderer's mermaid blocks (shell shape:
  // div.md-code-block with the language in its banner infostring).
  ctx.inject(['slots'], (scope: ClientContext) => {
    scope.slots.inject('conversation.input.dock', () =>
      scope.slots.register({
        name: 'conversation.input.dock',
        id: 'aionui-mermaid-chat',
        order: 91,
      }, MermaidChatEnhancer))
  })

  // The settings card: one master switch (issue #307) in the Web UI Plugins
  // group, bound to the 'aionui-panel' namespace through the family bridge
  // (or the official settings scope when the deployment exposes it).
  ctx.inject(['slots', 'settingsScope'], (settingsCtx: ClientContext) => {
    const binder = settingsCtx.get('webUiSettings') ?? settingsCtx.settingsScope
    const panelScope = binder.bind<AionUiPanelSettings>({ namespace: NS })
    const settingsCard = new AionUiSettingsCardController(panelScope)
    settingsCtx.slots.inject('web-ui.plugin.item', () => {
      const unregister = settingsCtx.slots.register({
        name: 'web-ui.plugin.item',
        id: 'aionui-panel',
        order: 110,
        locale: NS,
        inject: () => settingsCard.inject(),
      }, AionUiSettingsCard)
      return () => {
        settingsCard.dispose()
        unregister()
      }
    })
  })

  ctx.effect(() => {
    // Master switch (issue #307): the settings card edits the 'aionui-panel'
    // namespace through the family settings bridge (or the official scope).
    // While off, the panels, the floating button and the change stream stay
    // unmounted; toggling the switch re-mounts them live (the pet's model).
    let panelScope: SettingsScope<AionUiPanelSettings> | undefined
    try {
      const binder = ctx.get('webUiSettings') ?? ctx.settingsScope
      if (binder !== undefined) panelScope = binder.bind<AionUiPanelSettings>({ namespace: NS })
    } catch (error) {
      // A missing settings seam must not break the panel boot: default on.
      panelScope = undefined
    }
    const enabled = (): boolean => panelScope?.getSnapshot().value?.enabled ?? true
    let disposeUi: (() => void) | undefined

    /**
     * Mount the whole panel UI (columns, handles, floating button, change
     * stream, persists) and return its teardown. A fresh lifecycle per
     * enable keeps toggling idempotent (the layout controller cannot be
     * reused after dispose).
     */
    const mountUi = (): (() => void) => {
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
        stores.explorer.setRoot(root)
        stores.scm.setRoot(root)
        stores.preview.setRoot(root)
        // Read the open state AFTER setRoot restores the new root's persisted
        // tabs, so layout.previewOpen matches the preview store instead of the
        // stale pre-setRoot value (which kept the preview column hidden until
        // the first unrelated preview-store change).
        const previewOpen = stores.preview.getSnapshot().open
        lastPreviewOpen = previewOpen
        layoutSetRoot(stores.layout, root, previewOpen)

        if (root === '') return
        disposeEvents = subscribePanelEvents(root, (event) => {
          if (event.kind === 'fs') {
            void stores.explorer.handleFsChange()
            void stores.preview.handleFsChange()
          }
          if (event.kind === 'git') {
            // The host status is the only truth; land it directly.
            stores.scm.update((prev) => (prev.root !== root ? prev : { ...prev, repositories: event.repositories, loading: false }))
            // The index/worktree moved: every open diff tab is stale by now.
            void stores.preview.handleGitChange(root)
          }
          if (event.kind === 'gitUnavailable') {
            // The host could not run git at all: land the friendly unavailable
            // state once instead of leaving the SCM tab on "not a repository".
            stores.scm.update((prev) => (prev.root !== root ? prev : { ...prev, repositories: [], loading: false, gitMissing: true }))
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

      // Chat file-reference clicks (issue #314): recognize workspace paths in
      // transcript code spans and locate them in the Explorer / Preview.
      const onFileRefClick = (event: MouseEvent): void => {
        try {
          handleFileRefClick(stores, api, event)
        } catch (error) {
          // A broken locate must never break the transcript's own clicks.
          console.error('[dsh-aionui-panel] file ref locate failed:', error)
        }
      }
      document.addEventListener('click', onFileRefClick)

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
        document.removeEventListener('click', onFileRefClick)
        disposeEvents?.()
        langObserver?.disconnect()
        for (const dispose of disposers) dispose()
        layout.dispose()
      }
    }
    const syncUi = (): void => {
      if (enabled() && disposeUi === undefined) {
        disposeUi = mountUi()
      } else if (!enabled() && disposeUi !== undefined) {
        disposeUi()
        disposeUi = undefined
      }
    }
    syncUi()
    const unsubscribeSettings = panelScope?.subscribe(syncUi)
    return () => {
      unsubscribeSettings?.()
      if (disposeUi !== undefined) {
        disposeUi()
        disposeUi = undefined
      }
    }
  }, 'dsh-aionui-panel: wiring')
}
