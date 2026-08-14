/**
 * 会话信息 view tab — the per-session management surface of the plugin.
 *
 * Registered as a `conversation.view` entry (id `session-info`, order 20),
 * rendered as a tab right of 对话/轨迹. Shows:
 *  - session metadata (id, cwd, createdAt, title, agent preset) from the
 *    host /session-info route;
 *  - the session's SUB-WORKSPACES: list, remove, and a hint on how to add
 *    (agent requests via workscope_workspace, approved through the card);
 *  - recent audit entries of this session.
 *
 * Failure policy: fetch problems degrade to a quiet retry loop — this panel
 * must never take the GUI down (external-plugin discipline).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AuditEntry, SessionInfoView, WorkspaceView } from '../protocol.ts'
import type { WorkscopeApi } from './api.ts'
import type { BeyondKey } from './locales.ts'
import css from './SessionInfoPanel.module.css'

/** Poll cadence for workspaces/audit (ms). */
const POLL_MS = 2000

/** Shorten an absolute path for display (keep head + tail). */
function shorten(path: string, max = 48): string {
  if (path.length <= max) return path
  const head = 20
  const tail = max - head - 1
  return `${path.slice(0, head)}…${path.slice(-tail)}`
}

/** Format an ISO instant as a compact local time. */
function clock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString([], {
    year: '2-digit', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

/** The 会话信息 tab body. */
export function SessionInfoPanel(props: {
  sessionId: string
  api: WorkscopeApi
  t: (key: BeyondKey) => string
}) {
  const { sessionId, api, t } = props
  const [info, setInfo] = useState<SessionInfoView | undefined>(undefined)
  const [workspaces, setWorkspaces] = useState<WorkspaceView[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [busy, setBusy] = useState<string | undefined>(undefined)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [nextWorkspaces, nextAudit, nextInfo] = await Promise.all([
        api.getWorkspaces(),
        api.getAudit(),
        api.getSessionInfo(sessionId),
      ])
      if (!mounted.current) return
      setWorkspaces(nextWorkspaces.filter(w => w.sessionId === sessionId))
      setAudit(nextAudit.filter(e => e.sessionId === sessionId))
      setInfo(nextInfo)
    } catch {
      // quiet retry — the panel stays visible with its last good data
    }
  }, [api, sessionId])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => { void refresh() }, POLL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const remove = (id: string): void => {
    if (busy !== undefined) return
    setBusy(id)
    api.removeWorkspace(id).then(refresh).catch(() => undefined).finally(() => {
      if (mounted.current) setBusy(undefined)
    })
  }

  const metaRows: Array<[string, string]> = [
    ['ID', sessionId],
    ...(info?.cwd === undefined ? [] : [['cwd', info.cwd] as [string, string]]),
    ...(info?.createdAt === undefined ? [] : [['created', clock(info.createdAt)] as [string, string]]),
    ...(info?.agentPreset === undefined ? [] : [['preset', info.agentPreset] as [string, string]]),
  ]

  return (
    <div className={css.root}>
      <div className={css.section}>
        <div className={css.sectionTitle}>{t('panel.session')}</div>
        {info?.title !== undefined && <div className={css.title}>{info.title}</div>}
        {metaRows.map(([label, value]) => (
          <div className={css.metaRow} key={label}>
            <span className={css.metaLabel}>{label}</span>
            <span className={css.metaValue} title={value}>{shorten(value, 64)}</span>
          </div>
        ))}
      </div>

      <div className={css.section}>
        <div className={css.sectionTitle}>{t('panel.workspaces')}</div>
        {workspaces.length === 0 && <div className={css.empty}>{t('panel.workspaces.empty')}</div>}
        {workspaces.map(workspace => (
          <div className={css.row} key={workspace.id}>
            <div className={css.rowMain}>
              <div className={css.rowTitle}>{workspace.title}</div>
              <div className={css.rowPath} title={workspace.path}>{shorten(workspace.path, 56)}</div>
              <div className={css.rowMeta}>{clock(workspace.createdAt)}</div>
            </div>
            <button
              type="button"
              className={css.removeButton}
              data-busy={busy === workspace.id}
              onClick={() => remove(workspace.id)}
            >
              {t('panel.remove')}
            </button>
          </div>
        ))}
        <div className={css.hint}>{t('panel.workspaces.hint')}</div>
      </div>

      <div className={css.section}>
        <div className={css.sectionTitle}>{t('panel.audit')}</div>
        {audit.length === 0 && <div className={css.empty}>{t('panel.audit.empty')}</div>}
        {audit.slice(0, 10).map(entry => (
          <div className={css.auditLine} key={entry.id}>
            <span className={css.auditTime}>{clock(entry.at)}</span>
            <span className={css.auditKind}>{entry.kind}</span>
            <span className={css.auditDetail}>{entry.detail}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
