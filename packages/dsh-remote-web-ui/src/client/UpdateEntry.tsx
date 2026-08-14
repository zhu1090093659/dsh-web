/**
 * The sidebar update seat: the download trigger beside the remote-control
 * trigger plus the update panel modal. Owns the flow — probe the registry
 * on open, auto-run the update when a newer release exists, report the
 * outcome (restart hint on success, translated failure on error).
 * Component-local state per the client stack rules.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { IconDownloadOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UpdateStatus } from '../update.ts'
import { fetchUpdateStatus, runUpdate } from "./update-api.ts"
import { UpdatePanel, type UpdateView } from "./UpdatePanel.tsx"
import css from "./remote.module.css"

/** Entry props: the sidebar column state + the standard locale seat. */
export interface UpdateEntryProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
  t: TranslateNS<'remote'>
}

/**
 * Render the update trigger and panel.
 * @param props - column state and locale seat.
 * @returns the entry element tree.
 */
export function UpdateEntry({ wide, t }: UpdateEntryProps) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<UpdateView>({ kind: "checking" })
  const runToken = useRef(0)

  const check = useCallback(async (): Promise<void> => {
    setView({ kind: "checking" })
    let status: UpdateStatus
    try {
      status = await fetchUpdateStatus()
    } catch {
      setView({ kind: "error", message: t("update.offline"), detail: t("update.offlineDetail") })
      return
    }
    if (status.error === "registry-unreachable") {
      setView({ kind: "result", status })
      return
    }
    setView({ kind: "result", status })
    // Auto-update: an npm install with a newer release proceeds without a
    // second confirmation — clicking the update trigger is the intent.
    if (status.mode !== "npm" || !status.outdated) return
    setView({ kind: "updating", status })
    const token = ++runToken.current
    try {
      const result = await runUpdate()
      if (token !== runToken.current) return
      setView({ kind: "done", result })
    } catch {
      if (token !== runToken.current) return
      setView({ kind: "error", message: t("update.error"), detail: t("update.offlineDetail") })
    }
  }, [t])

  const openPanel = useCallback((): void => {
    setOpen(true)
    void check()
  }, [check])

  const closePanel = useCallback((): void => {
    runToken.current++
    setOpen(false)
  }, [])

  // Unmount safety: an in-flight update must not land on a dead component.
  useEffect(() => () => { runToken.current++ }, [])

  return (
    <>
      <button
        type="button"
        className={css.trigger}
        data-wide={wide ? undefined : "rail"}
        aria-label={t("update.label")}
        title={t("update.label")}
        onClick={openPanel}
      >
        <IconDownloadOutline16 size={wide ? 16 : 18} />
      </button>
      {open && createPortal((
        <div className={css.overlay} role="presentation">
          <div className={css.mask} aria-hidden="true" onClick={closePanel} />
          <UpdatePanel t={t} view={view} onClose={closePanel} onRecheck={() => { void check() }} />
        </div>
      ), document.body)}
    </>
  )
}
