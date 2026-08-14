/**
 * Composer dock inlay: the drop target for explorer file drags. It mounts
 * in the official `conversation.input.dock` band (a session-scoped list
 * slot declared by the shipped ui-conversation rc.6 shell), so it stacks
 * with the git-graph chip above the composer card. While a file row is
 * dragged over the page it shows a hint strip; on drop it splices the
 * workspace-relative path into the active session's draft through the
 * conversation input facade.
 *
 * The document-level listeners only claim drags carrying our custom MIME —
 * the composer host's own drop handling (OS image files) is untouched. The
 * host's `dragover` refuses every drop it does not claim, so this inlay
 * must `preventDefault` its own drags to make the drop land.
 * @module dsh-aionui-panel/client/drag/DragFileInlay
 */

import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { FILE_DRAG_MIME, hasFileDrag } from './file-drag.ts'
import { t } from '../locales.ts'
import dragCss from '../styles/drag.module.css'

/** Injected business face of the drag inlay (session-routed). */
export interface DragFileInjected {
  /** Splice a workspace-relative path into the active session's draft. */
  insertPath: (path: string) => boolean
}

/** Composed props: the dock's runtime share (sessionId) + the injected verb. */
export type DragFileInlayProps =
  PropsRuntime<'conversation.input.dock'>
  & DragFileInjected

/**
 * The composer dock entry: a zero-height anchor that shows a hint strip
 * while a file row is dragged over the page and inserts the path on drop.
 * @param props - the composed dock entry props.
 */
export function DragFileInlay(props: DragFileInlayProps): ReactElement {
  const [active, setActive] = useState(false)
  const depth = useRef(0)

  useEffect(() => {
    const reset = (): void => {
      depth.current = 0
      setActive(false)
    }
    const onDragOver = (event: DragEvent): void => {
      if (!hasFileDrag(event.dataTransfer?.types)) return
      event.preventDefault()
      depth.current += 1
      setActive(true)
    }
    const onDragLeave = (event: DragEvent): void => {
      if (!hasFileDrag(event.dataTransfer?.types)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setActive(false)
    }
    const onDrop = (event: DragEvent): void => {
      if (!hasFileDrag(event.dataTransfer?.types)) return
      event.preventDefault()
      const path = event.dataTransfer?.getData(FILE_DRAG_MIME) ?? ''
      reset()
      if (path !== '') props.insertPath(path)
    }
    const onDragEnd = (): void => reset()
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
    window.addEventListener('dragend', onDragEnd)
    return () => {
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', onDragEnd)
    }
  }, [props.insertPath])

  return (
    <div
      className={active ? `${dragCss.strip} ${dragCss.stripActive}` : dragCss.strip}
      data-testid="aionui-drag-inlay"
      aria-live="polite"
    >
      {active ? <span className={dragCss.stripText}>{t('explorer.drag.dropHint')}</span> : null}
    </div>
  )
}
