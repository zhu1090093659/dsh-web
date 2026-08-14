/**
 * The update panel body: check progress, version comparison, the
 * auto-update in-flight state, and the outcome (restart hint on success,
 * translated failure on error). Pure presentation — all state arrives
 * through props from the entry behavior component.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { IconCloseOutline16, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UpdateRunResult, UpdateStatus } from '../update.ts'
import css from "./remote.module.css"

/** The panel view state, owned by the entry component. */
export type UpdateView =
  | { kind: 'checking' }
  | { kind: 'result'; status: UpdateStatus }
  | { kind: 'updating'; status: UpdateStatus }
  | { kind: 'done'; result: UpdateRunResult }
  | { kind: 'error'; message: string; detail?: string }

/** Full panel props: copy + view state + actions. */
export interface UpdatePanelProps {
  t: TranslateNS<'remote'>
  view: UpdateView
  onClose(): void
  /** Re-run the check from a terminal state. */
  onRecheck(): void
}

/** The anchor package name (aggregate first) for copy purposes. */
function anchorName(status: UpdateStatus | undefined): string | undefined {
  return status?.anchor ?? status?.packages[0]?.name
}

/** The latest npm release of the anchor, for reference copy. */
function anchorLatest(status: UpdateStatus | undefined): string | undefined {
  return status?.packages[0]?.latest
}

/**
 * Render the update panel.
 * @param props - copy, view state, and actions.
 * @returns the panel element tree.
 */
export function UpdatePanel({ t, view, onClose, onRecheck }: UpdatePanelProps) {
  const status = view.kind === "result" || view.kind === "updating" ? view.status : undefined
  const title = view.kind === "done" && view.result.ok ? t("update.done") : t("update.title")
  const subtitle = subtitleOf(t, view)
  return (
    <div className={css.panel} role="dialog" aria-modal="true" aria-label={title}>
      <div className={css.header}>
        <div className={css.heading}>
          <h2 className={css.title}>{title}</h2>
          {subtitle !== undefined && <p className={css.subtitle}>{subtitle}</p>}
        </div>
        <button type="button" className={css.close} aria-label={t("update.close")} onClick={onClose}>
          <IconCloseOutline16 />
        </button>
      </div>
      {view.kind === "checking" && <p className={css.updateStatus}>{t("update.checking")}</p>}
      {view.kind === "result" && status !== undefined && <ResultBody t={t} status={status} />}
      {view.kind === "updating" && status !== undefined && (
        <div>
          <p className={css.updateStatus}>
            {t("update.updating", { name: anchorName(status) ?? "", version: anchorLatest(status) ?? "" })}
          </p>
          <PackageList status={status} />
        </div>
      )}
      {view.kind === "done" && <DoneBody t={t} result={view.result} />}
      {view.kind === "error" && (
        <div>
          <p className={css.updateError}>{view.message}</p>
          {view.detail !== undefined && <pre className={css.updateOutput}>{view.detail}</pre>}
        </div>
      )}
      {(view.kind === "done" || view.kind === "error") && (
        <div className={css.updateActions}>
          <button type="button" className={css.updateRetry} onClick={onRecheck}>
            <IconRefreshOutline16 /> {t("update.retry")}
          </button>
        </div>
      )}
    </div>
  )
}

/** The subtitle copy per view state (absent on plain results). */
function subtitleOf(t: TranslateNS<"remote">, view: UpdateView): string | undefined {
  switch (view.kind) {
    case "checking":
      return t("update.checking")
    case "updating":
      return t("update.updatingTitle")
    case "result":
      return undefined
    case "done":
      return view.result.ok ? t("update.doneDetail") : t("update.error")
    case "error":
      // The error body below carries the message; no subtitle duplication.
      return undefined
  }
}

/** The checked result body: mode banner + version list. */
function ResultBody({ t, status }: { t: TranslateNS<"remote">; status: UpdateStatus }) {
  const anchor = anchorName(status)
  const latest = anchorLatest(status)
  if (status.mode === "link") {
    return (
      <div>
        <p className={css.updateStatus}>{t("update.linkMode")}</p>
        <p className={css.updateDetail}>{t("update.linkModeDetail", { version: latest ?? "-" })}</p>
      </div>
    )
  }
  if (status.mode === "missing") {
    return (
      <div>
        <p className={css.updateStatus}>{t("update.missing")}</p>
        <p className={css.updateDetail}>{t("update.missingDetail")}</p>
      </div>
    )
  }
  if (status.error === "registry-unreachable") {
    return (
      <div>
        <p className={css.updateStatus}>{t("update.offline")}</p>
        <p className={css.updateDetail}>{t("update.offlineDetail")}</p>
      </div>
    )
  }
  if (status.outdated) {
    return (
      <div>
        <p className={css.updateStatus}>{t("update.found")}</p>
        <p className={css.updateDetail}>
          {anchor !== undefined ? t("update.foundDetail", { name: anchor, version: latest ?? "" }) : ""}
        </p>
      </div>
    )
  }
  return (
    <div>
      <p className={css.updateStatus}>{t("update.upToDate")}</p>
      {anchor !== undefined && latest !== undefined && (
        <p className={css.updateDetail}>{t("update.upToDateDetail", { name: anchor, version: latest })}</p>
      )}
      <PackageList status={status} />
    </div>
  )
}

/** The per-package current → latest comparison list. */
function PackageList({ status }: { status: UpdateStatus }) {
  if (status.packages.length === 0) return null
  return (
    <ul className={css.updateList}>
      {status.packages.map(packageStatus => (
        <li key={packageStatus.name} className={css.updateListItem}>
          <span className={css.updateListName}>{packageStatus.name}</span>
          <span className={css.updateListVersions}>
            {packageStatus.current}
            {packageStatus.latest !== undefined && packageStatus.latest !== packageStatus.current && (
              <> → {packageStatus.latest}</>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** The outcome body: success + restart hint, or the translated failure. */
function DoneBody({ t, result }: { t: TranslateNS<"remote">; result: UpdateRunResult }) {
  if (result.ok) {
    // The title already reads "Update complete"; the body carries the details.
    return (
      <div>
        <p className={css.updateDetail}>{t("update.doneDetail")}</p>
        <p className={css.updateDetail}>{t("update.restartHint")}</p>
      </div>
    )
  }
  const message = errorMessageOf(t, result)
  return (
    <div>
      <p className={css.updateError}>{message}</p>
      {result.output.trim() !== "" && <pre className={css.updateOutput}>{result.output.trim()}</pre>}
    </div>
  )
}

/** Translate a structured failure code; fall back to the raw message. */
function errorMessageOf(t: TranslateNS<"remote">, result: UpdateRunResult): string {
  switch (result.errorCode) {
    case "pnpm-missing": return t("update.error.pnpmMissing")
    case "timeout": return t("update.error.timeout")
    case "not-found": return t("update.error.notFound")
    case "link": return t("update.error.link")
    case "pnpm-failed": return t("update.error.pnpmFailed", { code: String(result.exitCode ?? "?") })
    default: return result.error ?? t("update.error.unknown")
  }
}
