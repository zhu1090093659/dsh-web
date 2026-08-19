/**
 * Floating mount for the shutdown power button: a fixed bottom-right trigger
 * that is independent of the sidebar layout, so the exit control is always
 * visible. The confirm dialog portals from the same component.
 */
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { ShutdownEntry } from './ShutdownEntry.tsx'

/** What the floating mount needs from the plugin apply. */
export interface FloatingButtonFace {
  /** Locale reader bound to the `desktop-launcher` namespace. */
  t: TranslateNS<'desktop-launcher'>
  /** Whether the confirm dialog is required before exiting (settings-backed). */
  confirmShutdown: () => boolean
}

/**
 * Mount the floating power button into document.body.
 * @param face - locale copy and the confirm gate.
 * @returns the disposer unmounting the button and removing the host element.
 */
export function mountShutdownButton(face: FloatingButtonFace): () => void {
  const host = document.createElement('div')
  host.dataset.dshShutdownFloat = 'true'
  document.body.appendChild(host)
  const root = createRoot(host)
  root.render(createElement(ShutdownEntry, {
    wide: true,
    floating: true,
    t: face.t,
    confirmShutdown: face.confirmShutdown,
  }))
  return () => {
    root.unmount()
    host.remove()
  }
}