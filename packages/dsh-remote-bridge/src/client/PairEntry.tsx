/**
 * Sidebar footer entry for the protocol v1 pairing panel: the icon-only trigger
 * beside the sidebar settings seat (wide row / rail circle) that opens the
 * panel. Registered into the official `sidebar.footer.action` list slot
 * (declared by ui-sidebar — the same seat dsh-remote-web-ui and dsh-update
 * share).
 *
 * This component owns the panel's presence and behavior: one read per open, one
 * clock tick while a live code is on screen, the mint-again action, the copy
 * action, and the leave leg that keeps the modal mounted until its exit reports
 * completion. The wire call and the clipboard are injected (see the plugin
 * entry), so the rendered tree carries no closure-factory bundle import and both
 * can be driven by a test without patching a module.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { PairPanel, type PairCopyState, type PairPanelState } from './PairPanel.tsx'
import type { PairTokenOutcome } from './pair-token.ts'
import { PART_ENTRY, PLUGIN_ATTR } from './semantic.ts'
import { QrIcon } from './icons.tsx'
import css from './panel.module.css'

/** How long the transient "copied" / "copy failed" label stays up. */
const COPY_FEEDBACK_MS = 1_500
/** The countdown's tick; one second is the resolution the panel shows. */
const TICK_MS = 1_000
/**
 * Upper bound on the leave leg. The card reports its own animation end, and the
 * reduced-motion fade reports a transition end; this only ends the presence of a
 * browser that reports neither, just past var(--ds-transition-duration).
 */
const EXIT_TIMEOUT_MS = 260

/**
 * The modal's presence. `closing` is a state of its own: the card stays mounted
 * for its reverse exit and unmounts only when that exit reports completion,
 * instead of disappearing on the same tick as the click.
 */
type Presence = 'closed' | 'open' | 'closing'

export type PairEntryProps = PropsLocale<'remote-bridge'> & {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
  /** Reads a fresh one-shot token from this package's own Host route. */
  read: () => Promise<PairTokenOutcome>
  /** Puts the token on the OS clipboard; false means the write was refused. */
  copy: (text: string) => Promise<boolean>
}

/** Map a read outcome onto the panel's view state. */
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
 * Render the pairing seat trigger and, while it is open or leaving, the panel.
 * @param props - the footer seat's column state, the injected actions and the locale seat.
 * @returns the trigger and, when present, the official Modal holding the panel.
 */
export function PairEntry({ wide, read, copy, t }: PairEntryProps) {
  const [presence, setPresence] = useState<Presence>('closed')
  const [state, setState] = useState<PairPanelState>({ kind: 'reading' })
  const [copyState, setCopyState] = useState<PairCopyState>('idle')
  const [now, setNow] = useState<number>(() => Date.now())
  const panelId = useId()
  // Generation counter: closing (or minting again) invalidates a read that is
  // still in flight, so an answer that lands after the panel closed cannot
  // resurrect a code nobody asked for.
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

  // Escape, the mask click, the focus trap and focus restoration belong to the
  // official Modal; this only decides what closing means for the presence, and
  // it invalidates a read that is still in flight.
  const requestClose = useCallback((): void => {
    generation.current += 1
    setPresence((current) => (current === 'closed' ? 'closed' : 'closing'))
  }, [])

  const finishClose = useCallback((): void => {
    setPresence((current) => (current === 'closing' ? 'closed' : current))
  }, [])

  const closing = presence === 'closing'
  const showing = presence !== 'closed'

  // Safety net for the leave leg: the card normally reports its own animation or
  // transition end, and this bound covers the case where neither arrives.
  useEffect(() => {
    if (!closing) return
    const timer = window.setTimeout(() => { finishClose() }, EXIT_TIMEOUT_MS)
    return () => { window.clearTimeout(timer) }
  }, [closing, finishClose])

  // One ticker per live code; it clears itself at the deadline, so a panel left
  // open on an expired code stops re-rendering instead of ticking forever.
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
    <>
      <button
        type="button"
        className={css.trigger}
        data-dsh-plugin={PLUGIN_ATTR}
        data-dsh-part={PART_ENTRY}
        data-wide={wide ? 'wide' : 'rail'}
        aria-label={t('entry.label')}
        aria-expanded={showing}
        aria-controls={showing ? panelId : undefined}
        title={t('entry.label')}
        onClick={openPanel}
      >
        <QrIcon />
      </button>
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
    </>
  )
}
