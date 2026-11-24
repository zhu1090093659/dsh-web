/**
 * Official `conversation.session.panel.environment.row` entry: shows the
 * active session's id inside the official Session Panel's Environment section
 * with one-click copy, matching the panel's `data-session-panel-row` markup.
 * @module @linxin666/dsh-client-ui-session-id/client/SessionIdEnvironmentRow
 */
import { useEffect, useRef, useState } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-session-panel/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { CheckIcon, CopyIcon, SessionIdIcon } from './icons.tsx'
import { SESSION_ID_PART_COPY, SESSION_ID_PART_ENV_ROW, SESSION_ID_PLUGIN_ATTR } from './semantic.ts'
import css from './session-id.module.css'

export type SessionIdEnvironmentRowProps =
  & Partial<PropsRuntime<'conversation.session.panel.environment.row'>>
  & PropsLocale<'session-id'>
  & {
    /** Active session id supplied by the session-scoped slot runtime. */
    sessionId: string
    /** Clipboard writer override (defaults to official `writeClipboard`). */
    copy?: (text: string) => Promise<boolean>
  }

/**
 * Render the active session's id as a native row inside the Session Panel's
 * Environment section.
 */
export function SessionIdEnvironmentRow({
  sessionId,
  t,
  copy = writeClipboard,
}: SessionIdEnvironmentRowProps) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const idleTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    setStatus('idle')
    return () => { window.clearTimeout(idleTimer.current) }
  }, [sessionId])

  if (!sessionId) return null

  const handleCopy = (): void => {
    window.clearTimeout(idleTimer.current)
    void copy(sessionId).then((ok) => {
      if (ok) {
        setStatus('copied')
        idleTimer.current = window.setTimeout(() => { setStatus('idle') }, 1200)
      } else {
        setStatus('failed')
      }
    }).catch(() => {
      setStatus('failed')
    })
  }

  const copyLabel = status === 'copied'
    ? t('panel.copied')
    : status === 'failed'
      ? t('panel.copyFailed')
      : t('panel.copy')

  return (
    <div
      data-session-panel-row=""
      data-dsh-plugin={SESSION_ID_PLUGIN_ATTR}
      data-dsh-part={SESSION_ID_PART_ENV_ROW}
      data-session-id={sessionId}
    >
      <span data-row-part="body">
        <span data-row-part="icon" aria-hidden="true"><SessionIdIcon /></span>
        <span data-row-part="content" className={css.envContent} title={`${t('entry.label')}: ${sessionId}`}>
          <span className={css.envValue}>{sessionId}</span>
        </span>
      </span>
      <span data-row-part="menu">
        <button
          type="button"
          className={css.envCopyButton}
          data-dsh-part={SESSION_ID_PART_COPY}
          data-copied={status === 'copied' ? 'true' : undefined}
          data-failed={status === 'failed' ? 'true' : undefined}
          aria-label={`${copyLabel} ${sessionId}`}
          title={copyLabel}
          onClick={handleCopy}
        >
          {status === 'copied' ? <CheckIcon /> : <CopyIcon />}
        </button>
      </span>
    </div>
  )
}
