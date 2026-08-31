/**
 * Skill center panel mounting (browser half).
 *
 * The panel is an overlay modal rendered with its own React root appended to
 * document.body (no slot exists for external plugins). Opening mounts the
 * tree; closing unmounts and removes the container. The entry row toggles it
 * through the returned controller.
 */
import { createRoot, type Root } from 'react-dom/client'
import type { SkillApi } from './api.ts'
import { SkillPanel } from './SkillPanel.tsx'
import type { LocaleRefreshSource } from './sidebar-entry.ts'

/** Mounted panel controller: toggle/open/close plus the disposer. */
export interface SkillPanelMount {
  toggle: () => void
  open: () => void
  close: () => void
  dispose: () => void
}

/**
 * Mount the skill center overlay panel.
 * @param api - the skill center API client.
 * @param locale - locale-change source; when given, re-renders an open panel
 *   on a Language switch.
 * @returns controller (toggle/open/close) and the disposer.
 */
export function mountPanel(api: SkillApi, locale?: LocaleRefreshSource): SkillPanelMount {
  let root: Root | undefined
  let container: HTMLDivElement | undefined
  let unsubscribeLocale: (() => void) | undefined

  const close = (): void => {
    if (root === undefined) return
    root.unmount()
    root = undefined
    container?.remove()
    container = undefined
  }
  try {
    unsubscribeLocale = locale?.subscribe(() => {
      if (root !== undefined) root.render(<SkillPanel api={api} onClose={close} />)
    })
  } catch { /* locale service absent: the panel follows its next natural re-render */ }

  const open = (): void => {
    if (root !== undefined) return
    container = document.createElement('div')
    container.dataset.dshSkillExplorerView = ''
    // L2 semantic attributes (issue #506): the plugin id lets skins anchor this
    // overlay root; see contracts/semantic-attrs-v1.md.
    container.dataset.dshPlugin = 'skill-explorer'
    document.body.appendChild(container)
    root = createRoot(container)
    root.render(<SkillPanel api={api} onClose={close} />)
  }

  const toggle = (): void => {
    if (root !== undefined) close()
    else open()
  }

  return { toggle, open, close, dispose: () => { close(); unsubscribeLocale?.() } }
}
