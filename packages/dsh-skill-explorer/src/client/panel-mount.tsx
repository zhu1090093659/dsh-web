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
 * @returns controller (toggle/open/close) and the disposer.
 */
export function mountPanel(api: SkillApi): SkillPanelMount {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  const close = (): void => {
    if (root === undefined) return
    root.unmount()
    root = undefined
    container?.remove()
    container = undefined
  }

  const open = (): void => {
    if (root !== undefined) return
    container = document.createElement('div')
    container.dataset.dshSkillExplorerView = ''
    document.body.appendChild(container)
    root = createRoot(container)
    root.render(<SkillPanel api={api} onClose={close} />)
  }

  const toggle = (): void => {
    if (root !== undefined) close()
    else open()
  }

  return { toggle, open, close, dispose: close }
}
