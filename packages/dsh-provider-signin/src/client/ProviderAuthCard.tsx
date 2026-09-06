/**
 * The provider-card sign-in seat: status line, method buttons, and the
 * attempt panel (notices, prompts, cancel) for one llm-pi-ai provider row.
 * Renders nothing for rows whose flow offers no OAuth method — the core
 * editor already covers API-key entry.
 * @module @linxin666/dsh-provider-signin/client/ProviderAuthCard
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { FlowState, SigninApi } from './api.ts'
import type { AttemptView } from '../core/types.ts'
import type { SigninKey } from './locales.ts'
import styles from './signin.module.css'

/** The Models page owner share of this seat (structural: the declaring package owns the type). */
export interface ProviderAuthOwnerProps {
  /** The card's directory row. */
  provider: {
    provider: string
    displayName: string
    settingsNs: string
    settingsPath: readonly string[]
    active: boolean
    declared?: boolean
  }
  /** Whether any layer configures this provider. */
  configured: boolean
  /** Whether the row's api-key reference is confirmed configured. */
  keyConfigured: boolean
}

/** The registration-side face injected next to the owner props. */
export interface ProviderAuthFace {
  /** The relay API. */
  api: SigninApi
  /** Namespace-bound copy. */
  t: (key: SigninKey) => string
}

export interface ProviderAuthProps extends ProviderAuthFace, ProviderAuthOwnerProps {}

/** Poll cadence while an attempt is running. */
const ATTEMPT_POLL_MS = 1_200
/** Poll cadence for the idle flow/record state. */
const FLOW_POLL_MS = 12_000

/**
 * One provider card's sign-in area. State is deliberately local: the card
 * polls the relay while mounted and holds nothing after unmount. The slot
 * renderer passes the owner props and the injected face merged at the top
 * level, so props are read flat.
 */
export function ProviderAuthCard({ provider, api, t }: ProviderAuthProps): ReactNode {
  const routeKey = `llm-pi-ai/${provider.provider}`
  const [state, setState] = useState<FlowState | undefined>(undefined)
  const [transportError, setTransportError] = useState<string | undefined>(undefined)
  const [attempt, setAttempt] = useState<AttemptView | undefined>(undefined)
  const [answerDraft, setAnswerDraft] = useState('')
  // The accumulating attempt view; the poll merges deltas into it.
  const attemptRef = useRef<AttemptView | undefined>(undefined)
  const aliveRef = useRef(true)

  const refreshFlow = useCallback((): void => {
    void api.flow(routeKey).then((result) => {
      if (!aliveRef.current) return
      if (result.ok) {
        setState(result.value)
        setTransportError(undefined)
      } else {
        setTransportError(result.error)
      }
    })
  }, [api, routeKey])

  useEffect(() => {
    aliveRef.current = true
    refreshFlow()
    const timer = window.setInterval(refreshFlow, FLOW_POLL_MS)
    return () => {
      aliveRef.current = false
      window.clearInterval(timer)
    }
  }, [refreshFlow])

  // Attempt poll loop: runs only while an attempt is in flight.
  useEffect(() => {
    if (attempt === undefined || attempt.status !== 'running') return
    const id = attempt.id
    const timer = window.setInterval(() => {
      const since = attemptRef.current?.notices.at(-1)?.seq ?? 0
      void api.attempt(id, since).then((result) => {
        if (!aliveRef.current || !result.ok) return
        const next = result.value
        const previous = attemptRef.current
        attemptRef.current = previous === undefined ? next : {
          ...next,
          notices: [...previous.notices, ...next.notices],
        }
        setAttempt(attemptRef.current)
        if (next.status !== 'running') refreshFlow()
      })
    }, ATTEMPT_POLL_MS)
    return () => { window.clearInterval(timer) }
  }, [api, attempt, refreshFlow])

  const signIn = (method: string | undefined): void => {
    attemptRef.current = undefined
    setAttempt(undefined)
    setAnswerDraft('')
    void api.begin(routeKey, method).then((result) => {
      if (!aliveRef.current) return
      if (!result.ok) {
        setTransportError(result.error)
        return
      }
      void api.attempt(result.value.attemptId, 0).then((snapshot) => {
        if (!aliveRef.current || !snapshot.ok) return
        attemptRef.current = snapshot.value
        setAttempt(snapshot.value)
      })
    })
  }

  const cancel = (): void => {
    const id = attemptRef.current?.id
    if (id !== undefined) void api.cancel(id)
  }

  const answer = (value: string): void => {
    const current = attemptRef.current
    const pending = current?.pending
    if (current === undefined || pending === undefined) return
    void api.answer(current.id, pending.id, value).then(() => {
      setAnswerDraft('')
    })
  }

  // Only OAuth flows belong here; key-based providers are the core editor's job.
  const oauthMethods = state?.flow?.methods.filter(method => method.id === 'oauth') ?? []
  const show = oauthMethods.length > 0 || attempt !== undefined
  if (!show) return null

  const statusLine = state === undefined
    ? undefined
    : state.record?.configured === true
      ? (state.record.kind === 'grant' ? t('status.oauth') : t('status.apikey'))
      : t('status.none')

  return (
    <div className={styles['signin']}>
      {transportError !== undefined && <div className={styles['error']}>{t('transport')}: {transportError}</div>}
      {statusLine !== undefined && (
        <div className={styles['statusRow']}>
          <span className={styles['badge']} data-state={state?.record?.configured === true ? 'on' : 'off'}>
            {statusLine}
          </span>
        </div>
      )}
      {attempt === undefined && oauthMethods.length > 0 && (
        <div className={styles['methods']}>
          {oauthMethods.map(method => (
            <button
              key={method.id}
              type='button'
              className={styles['button']}
              onClick={() => { signIn(method.id) }}
            >
              {t('signIn')} · {method.label}
            </button>
          ))}
        </div>
      )}
      {attempt !== undefined && (
        <div className={styles['attempt']}>
          <div className={styles['attemptHead']}>
            {attempt.status === 'running' ? t('running') : attempt.status === 'authorized'
              ? t('authorized')
              : attempt.status === 'cancelled'
                ? t('cancelled')
                : `${t('failed')}: ${attempt.error ?? ''}`}
          </div>
          {attempt.notices.map(notice => (
            <div key={notice.seq} className={styles['notice']}>
              <div>{notice.message}</div>
              {notice.url !== undefined && (
                <div>
                  <a href={notice.url} target='_blank' rel='noreferrer'>{t('openPage')}</a>
                </div>
              )}
              {notice.code !== undefined && <div className={styles['code']}>{t('enterCode')} <code>{notice.code}</code></div>}
            </div>
          ))}
          {attempt.pending !== undefined && (
            <div className={styles['prompt']}>
              <div>{attempt.pending.message}</div>
              {attempt.pending.kind === 'select' && (
                <div className={styles['methods']}>
                  {(attempt.pending.options ?? []).map(option => (
                    <button
                      key={option.id}
                      type='button'
                      className={styles['button']}
                      onClick={() => { answer(option.id) }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
              {attempt.pending.kind !== 'select' && (
                <form
                  className={styles['answerRow']}
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (answerDraft.trim().length > 0) answer(answerDraft.trim())
                  }}
                >
                  <input
                    className={styles['input']}
                    type={attempt.pending.kind === 'secret' ? 'password' : 'text'}
                    value={answerDraft}
                    placeholder={attempt.pending.placeholder ?? (attempt.pending.kind === 'secret' ? t('secretPrompt') : t('inputPrompt'))}
                    onChange={event => { setAnswerDraft(event.target.value) }}
                  />
                  <button type='submit' className={styles['button']} disabled={answerDraft.trim().length === 0}>
                    {t('answer')}
                  </button>
                </form>
              )}
            </div>
          )}
          <div className={styles['methods']}>
            {attempt.status === 'running'
              ? (
                  <button type='button' className={styles['buttonSecondary']} onClick={() => { cancel() }}>
                    {t('cancel')}
                  </button>
                )
              : (
                  <button type='button' className={styles['buttonSecondary']} onClick={() => {
                    attemptRef.current = undefined
                    setAttempt(undefined)
                    refreshFlow()
                  }}>
                    {t('close')}
                  </button>
                )}
          </div>
        </div>
      )}
    </div>
  )
}
