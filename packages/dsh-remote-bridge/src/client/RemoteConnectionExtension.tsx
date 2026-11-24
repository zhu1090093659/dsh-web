/**
 * Official `settings.remoteConnection.extensions` extension card for protocol
 * v1 (iOS App) pairing.
 *
 * Renders beneath the official Remote Connection settings panel so operators
 * discover mobile-app pairing alongside official browser remote access, while
 * reusing the same loopback-only pair-token modal (`PairPanel`) and existing
 * localized copy.
 * @module @linxin666/dsh-remote-bridge/client/RemoteConnectionExtension
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type {} from '@deepseek-ai/dsh-client-remote-connection/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { PairPanel, type PairCopyState, type PairPanelState } from './PairPanel.tsx'
import type { PairTokenOutcome } from './pair-token.ts'
import { PLUGIN_ATTR } from './semantic.ts'
import { QrIcon } from './icons.tsx'
import css from './panel.module.css'

const COPY_FEEDBACK_MS = 1_500
const TICK_MS = 1_000
const EXIT_TIMEOUT_MS = 260

type Presence = 'closed' | 'open' | 'closing'

export type RemoteConnectionExtensionCardProps =
  & Partial<PropsRuntime<'settings.remoteConnection.extensions'>>
  & PropsLocale<'remote-bridge'>
  & {
    /** Reads a fresh one-shot token from this package's own Host route. */
    read: () => Promise<PairTokenOutcome>
    /** Puts the token on the OS clipboard; false means the write was refused. */
    copy: (text: string) => Promise<boolean>
  }

function panelStateOf(outcome: PairTokenOutcome, issuedAt: number): PairPanelState {
  switch (outcome.kind) {
    case 'ok':
      return {
        kind: 'ready',
        token: outcome.token,
        issuedAt,
        expiresAt: outcome.expiresAt,
        origin: outcome.origin,
        originSource: outcome.originSource,
        pairingUrl: outcome.pairingUrl,
      }
    case 'forbidden': return { kind: 'forbidden' }
    case 'unreachable': return { kind: 'unreachable' }
    case 'failed': return { kind: 'failed', status: outcome.status }
  }
}

/**
 * Extension card registered into `settings.remoteConnection.extensions`.
 */
export function RemoteConnectionExtension({ read, copy, t }: RemoteConnectionExtensionCardProps) {
  const [presence, setPresence] = useState<Presence>('closed')
  const [state, setState] = useState<PairPanelState>({ kind: 'reading' })
  const [copyState, setCopyState] = useState<PairCopyState>('idle')
  const [now, setNow] = useState<number>(() => Date.now())
  const panelId = useId()
  const generation = useRef(0)

  const mint = useCallback((): void => {
    const request = ++generation.current
    setState({ kind: 'reading' })
    void read().then((outcome) => {
      if (request !== generation.current) return
      const issuedAt = Date.now()
      setNow(issuedAt)
      setState(panelStateOf(outcome, issuedAt))
    })
  }, [read])

  const openPanel = useCallback((): void => {
    setPresence('open')
    setCopyState('idle')
    mint()
  }, [mint])

  const requestClose = useCallback((): void => {
    generation.current += 1
    setPresence((current) => (current === 'closed' ? 'closed' : 'closing'))
  }, [])

  const finishClose = useCallback((): void => {
    setPresence((current) => (current === 'closing' ? 'closed' : current))
  }, [])

  const closing = presence === 'closing'
  const showing = presence !== 'closed'

  useEffect(() => {
    if (!closing) return
    const timer = window.setTimeout(() => { finishClose() }, EXIT_TIMEOUT_MS)
    return () => { window.clearTimeout(timer) }
  }, [closing, finishClose])

  useEffect(() => {
    if (presence !== 'open' || state.kind !== 'ready') return
    const deadline = state.expiresAt
    const timer = window.setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= deadline) window.clearInterval(timer)
    }, TICK_MS)
    return () => { window.clearInterval(timer) }
  }, [presence, state])

  const handleCopy = useCallback((payload: string): void => {
    void copy(payload).then((ok) => {
      setCopyState(ok ? 'copied' : 'failed')
      window.setTimeout(() => { setCopyState('idle') }, COPY_FEEDBACK_MS)
    })
  }, [copy])

  return (
    <section
      className={css.extensionCard}
      data-dsh-plugin={PLUGIN_ATTR}
      data-dsh-part="remote-connection-extension"
    >
      <div className={css.extensionBody}>
        <div className={css.extensionHeader}>
          <span className={css.extensionIcon} aria-hidden="true"><QrIcon /></span>
          <h4 className={css.extensionTitle}>{t('title')}</h4>
        </div>
        <p className={css.extensionSubtitle}>{t('subtitle')}</p>
      </div>
      <div className={css.extensionActions}>
        <Button
          variant="outline"
          size="sm"
          aria-expanded={showing}
          aria-controls={showing ? panelId : undefined}
          onClick={openPanel}
        >
          {t('entry.label')}
        </Button>
      </div>
      {showing && (
        <PairPanel
          id={panelId}
          t={t}
          state={state}
          now={now}
          host={window.location.host}
          copy={copyState}
          showing={showing}
          closing={closing}
          onClose={requestClose}
          onExited={finishClose}
          onRefresh={mint}
          onCopy={handleCopy}
        />
      )}
    </section>
  )
}
