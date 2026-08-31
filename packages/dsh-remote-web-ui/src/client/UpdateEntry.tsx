/**
 * The sidebar update seat: the download trigger beside the remote-control
 * trigger plus the update panel modal. Owns the flow — probe the registry
 * on open, show the result, and let the user start the update from the
 * result view (#507), then report the outcome (restart hint on success,
 * translated failure on error).
 * Component-local state per the client stack rules.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { IconDownloadOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UpdateStatus } from '../update.ts'
import { fetchUpdateStatus, runUpdate, UpdateStatusError } from "./update-api.ts"
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
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const runToken = useRef(0)
  const availabilityToken = useRef(0)
  const mounted = useRef(false)

  const probeAvailability = useCallback(async (): Promise<void> => {
    const token = ++availabilityToken.current
    try {
      const status = await fetchUpdateStatus()
      if (token === availabilityToken.current) {
        setUpdateAvailable(status.mode === "npm" && status.outdated)
      }
    } catch {
      if (token === availabilityToken.current) setUpdateAvailable(false)
    }
  }, [])

  const check = useCallback(async (): Promise<void> => {
    const availabilityCheck = ++availabilityToken.current
    setView({ kind: "checking" })
    let status: UpdateStatus
    try {
      status = await fetchUpdateStatus()
    } catch (error) {
      if (availabilityCheck === availabilityToken.current) setUpdateAvailable(false)
      // HTTP 404: the update route is not mounted — the host process runs an
      // older plugin build (client refreshed, host did not). Restarting dsh
      // web loads the new plugin; a plain network failure gets the generic
      // offline copy instead of a misleading "cannot reach update source".
      if (error instanceof UpdateStatusError && error.status === 404) {
        setView({ kind: "error", message: t("update.unmounted"), detail: t("update.unmountedDetail") })
        return
      }
      setView({ kind: "error", message: t("update.offline"), detail: t("update.offlineDetail") })
      return
    }
    if (availabilityCheck === availabilityToken.current) {
      setUpdateAvailable(status.mode === "npm" && status.outdated)
    }
    if (status.error === "registry-unreachable") {
      setView({ kind: "result", status })
      return
    }
    // Checking never starts an update by itself (#507): the result view
    // carries the confirmation button that calls startUpdate.
    setView({ kind: "result", status })
  }, [t])

  const startUpdate = useCallback(async (status: UpdateStatus): Promise<void> => {
    if (status.mode !== "npm" || !status.outdated) return
    setView({ kind: "updating", status })
    const token = ++runToken.current
    try {
      const result = await runUpdate()
      if (result.ok && mounted.current) setUpdateAvailable(false)
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

  // Check once after mount without opening the panel or starting an update.
  useEffect(() => {
    mounted.current = true
    void probeAvailability()
    return () => {
      mounted.current = false
      runToken.current++
      availabilityToken.current++
    }
  }, [probeAvailability])

  const updateLabel = updateAvailable ? t("update.availableLabel") : t("update.label")

  return (
    <>
      <button
        type="button"
        className={css.trigger}
        data-wide={wide ? (updateAvailable ? "wide" : undefined) : "rail"}
        data-update-available={updateAvailable ? "true" : undefined}
        aria-label={updateLabel}
        aria-expanded={open}
        title={updateLabel}
        onClick={openPanel}
      >
        <IconDownloadOutline16 size={wide ? 16 : 18} />
        {updateAvailable && wide && (
          <span className={css.updateBadgeText}>{t("update.badge")}</span>
        )}
      </button>
      {open && createPortal((
        <div className={css.overlay} role="presentation">
          <div className={css.mask} aria-hidden="true" onClick={closePanel} />
          <UpdatePanel t={t} view={view} onClose={closePanel} onRecheck={() => { void check() }} onStartUpdate={(status) => { void startUpdate(status) }} />
        </div>
      ), document.body)}
    </>
  )
}
