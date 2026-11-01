/**
 * The protocol v1 pairing panel: the QR symbol, the countdown with its expiry
 * state, the one address fact the reader must not miss, and the two actions that
 * keep a fresh code on screen.
 *
 * The shell is the official headless `Modal` and every action is the official
 * `Button`, so the overlay, the mask, the card, the focus trap, the Escape
 * command and the interaction states belong to the library. This file owns the
 * information order and the state presentation only: every state and action
 * arrives through props, and the clock is a prop, so the expiry flip is
 * deterministic instead of read from `Date.now()` here.
 */
import { memo, useLayoutEffect, useRef } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  Button, IconCheckOutlineRegular, IconCloseOutlineRegular, IconCopyOutlineRegular,
  IconRefreshOutlineRegular, IconWarningOutlineRegular, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  EXPIRED_ATTR, PART_COPY, PART_NOTICE, PART_PANEL, PART_QR, PART_REFRESH, PLUGIN_ATTR, QR_VALUE_ATTR,
} from './semantic.ts'
import css from './panel.module.css'

/** The custom property carrying the dialog's own enter keyframe name. */
const EXIT_NAME_VAR = '--pair-exit-name'

/**
 * Where a reader of the beta build can reach the people running it. The URL is
 * code, not copy: the dictionaries carry the sentence, this constant carries the
 * destination, so a translation cannot retarget the link and a check can assert
 * the real one.
 */
export const COMMUNITY_INVITE_URL = 'https://discord.gg/nBy28kjun'

/** What the panel is currently showing. */
export type PairPanelState =
  /** A read is in flight. */
  | { kind: 'reading' }
  /**
   * A live one-shot secret. `pairingUrl`, when the host could name its own
   * public origin, is what the QR encodes: a `{token, url}` document the iOS
   * client parses into both halves of its configuration, so one scan sets the
   * address AND the token. With no origin the QR carries the bare token and the
   * panel says the address has to be set on the phone by hand.
   */
  | { kind: 'ready'; token: string; issuedAt: number; expiresAt: number; origin: string | null; pairingUrl: string | null }
  /** 403 from the loopback gate: this page is not open on the machine itself. */
  | { kind: 'forbidden' }
  /** The host route answered with an unexpected status or shape. */
  | { kind: 'failed'; status: number }
  /** The request never reached the host. */
  | { kind: 'unreachable' }

/** How the last copy attempt went. */
export type PairCopyState = 'idle' | 'copied' | 'failed'

export interface PairPanelProps {
  t: PropsLocale<'remote-bridge'>['t']
  state: PairPanelState
  /** The current wall clock; the entry supplies it from a one-second ticker. */
  now: number
  /** This page's own `host:port`, named in the origin warning. */
  host: string
  copy: PairCopyState
  /** Whether the modal is mounted at all (the entry keeps it for the leave leg). */
  showing: boolean
  /** Whether the leave leg is running; the card stays mounted until it ends. */
  closing: boolean
  /** The panel element's id, so the seat trigger can name what it expands. */
  id: string
  onClose(): void
  /** The leave leg reported completion: the entry may unmount the modal now. */
  onExited(): void
  onRefresh(): void
  onCopy(payload: string): void
}

/**
 * The QR symbol, memoized on the secret: the countdown re-renders the panel
 * every second, and qrcode.react rebuilds the whole module path on each render.
 * The encoded value is the host's own `pairingUrl` verbatim when there is one —
 * a `{token, url}` document whose `url` names THIS instance's public relay, so
 * the phone adopts an origin that actually reaches this host. The bare-token
 * fallback means the phone keeps whatever origin it already has.
 */
const PairQrCode = memo(function PairQrCode({ value, label }: { value: string; label: string }) {
  return <QRCodeSVG value={value} size={184} level="M" marginSize={1} aria-label={label} />
})

/** The one string the panel hands out: what the symbol encodes, what copy copies. */
function payloadOf(state: PairPanelState): string {
  return state.kind === 'ready' ? (state.pairingUrl ?? state.token) : ''
}

/**
 * Render the pairing panel.
 * @param props - locale seat, view state, clock, page host and actions.
 * @returns the panel element tree.
 */
export function PairPanel({
  t, state, now, host, copy, showing, closing, id, onClose, onExited, onRefresh, onCopy,
}: PairPanelProps) {
  const panel = useRef<HTMLDivElement | null>(null)
  const ready = state.kind === 'ready'
  const remainingMs = ready ? Math.max(0, state.expiresAt - now) : 0
  const expired = ready && remainingMs <= 0
  const seconds = Math.ceil(remainingMs / 1000)
  const windowMs = ready ? Math.max(1, state.expiresAt - state.issuedAt) : 1
  const percent = Math.min(100, Math.max(0, Math.round((remainingMs / windowMs) * 100)))
  const payload = payloadOf(state)
  // Only a live code can be handed out. An expired one is still on screen, so
  // its button stays put and reports that it is switched off.
  const canCopy = !expired && payload !== ''
  // A refusal the host raised is retried; a live or expired code is minted again.
  const primaryLabel = state.kind === 'failed' || state.kind === 'unreachable' ? t('action.retry') : t('pair.refresh')
  const located = ready && state.pairingUrl !== null

  // The library owns the enter animation and the bundler scopes its keyframe
  // name, so the leave leg cannot name it in CSS. Read the mounted dialog's own
  // animation at the moment closing starts and hand it to the card: the exit
  // then plays that exact keyframe backwards (M2, same path reversed). Clearing
  // it on reopen is what lets the same card come back to full opacity.
  useLayoutEffect(() => {
    const element = panel.current
    if (element === null) return
    if (!closing) {
      element.style.removeProperty(EXIT_NAME_VAR)
      return
    }
    const dialog = element.parentElement
    const enter = dialog === null ? '' : window.getComputedStyle(dialog).animationName
    if (enter !== '' && enter !== 'none') element.style.setProperty(EXIT_NAME_VAR, enter)
  }, [closing])

  return (
    <Modal open={showing} onClose={onClose} title={t('title')} headless className={css.dialog}>
      <div
        ref={panel}
        id={id}
        className={css.panel}
        data-dsh-plugin={PLUGIN_ATTR}
        data-dsh-part={PART_PANEL}
        data-closing={closing || undefined}
        onAnimationEnd={(event) => {
          if (closing && event.target === event.currentTarget) onExited()
        }}
        onTransitionEnd={(event) => {
          if (closing && event.target === event.currentTarget && event.propertyName === 'opacity') onExited()
        }}
      >
        <header className={css.header}>
          <div className={css.heading}>
            <h2 className={css.title}>{t('title')}</h2>
            <p className={css.subtitle}>{t('subtitle')}</p>
          </div>
          <Button
            className={css.close}
            variant="ghost"
            size="sm"
            aria-label={t('action.close')}
            icon={<IconCloseOutlineRegular />}
            onClick={onClose}
          />
        </header>

        <div className={css.body}>
          {(state.kind === 'forbidden' || state.kind === 'failed' || state.kind === 'unreachable') && (
            <div className={css.notice} data-dsh-part={PART_NOTICE} data-tone="alert" role="alert">
              <span className={css.noticeIcon} aria-hidden="true"><IconWarningOutlineRegular /></span>
              <div className={css.noticeCopy}>
                <p className={css.noticeTitle}>
                  {state.kind === 'forbidden' && t('forbidden.title')}
                  {state.kind === 'failed' && t('failed.title')}
                  {state.kind === 'unreachable' && t('unreachable.title')}
                </p>
                <p className={css.noticeText}>
                  {state.kind === 'forbidden' && t('forbidden.body')}
                  {state.kind === 'failed' && t('failed.body', { status: String(state.status) })}
                  {state.kind === 'unreachable' && t('unreachable.body')}
                </p>
              </div>
            </div>
          )}

          {(state.kind === 'reading' || ready) && (
            <>
              <div className={css.qrCard}>
                <div
                  className={css.qrSlot}
                  data-dsh-part={PART_QR}
                  {...{ [QR_VALUE_ATTR]: payload }}
                  {...{ [EXPIRED_ATTR]: expired || undefined }}
                >
                  {ready ? (
                    <PairQrCode value={payload} label={t('pair.qrLabel')} />
                  ) : (
                    <span className={css.skeleton} aria-hidden="true" />
                  )}
                </div>
                <div className={css.status}>
                  {!ready && <p className={css.statusText}>{t('state.reading')}</p>}
                  {ready && expired && <p className={css.statusText} role="status">{t('pair.expired')}</p>}
                  {ready && !expired && (
                    <>
                      <p className={css.statusText}>{t('pair.countdown', { s: String(seconds) })}</p>
                      <span className={css.bar} aria-hidden="true">
                        <span className={css.barFill} style={{ width: `${String(percent)}%` }} />
                      </span>
                    </>
                  )}
                </div>
              </div>

              <p className={css.address} data-tone={located ? 'plain' : 'warning'}>
                {ready && located && t('origin.located', { origin: state.origin ?? '' })}
                {ready && !located && t('origin.missing', { host })}
              </p>
              <p className={css.hint}>{t('pair.usedHint')}</p>
            </>
          )}

          {/* The one way out of a beta, offered in every state including a
              refusal: a reader who cannot pair is exactly the one with a
              question. It closes the body, so the last thing on the card is the
              way to ask rather than the code they already have. */}
          <a
            className={css.invite}
            href={COMMUNITY_INVITE_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('community.invite')}
          </a>
        </div>

        {/* The row exists only while it holds an action: a refusal offers
            nothing to press, and copy itself needs a code to hand out. An
            actionless row would still spend the panel's own gap. */}
        {state.kind !== 'forbidden' && (
          <footer className={css.actions}>
            {ready && (
              <Button
                variant="outline"
                size="sm"
                data-dsh-part={PART_COPY}
                disabled={!canCopy}
                icon={copy === 'copied' ? <IconCheckOutlineRegular /> : <IconCopyOutlineRegular />}
                onClick={() => { onCopy(payload) }}
              >
                <span className={css.labels}>
                  <span className={css.label} data-visible={copy === 'idle'} aria-hidden={copy !== 'idle'}>
                    {t('action.copy')}
                  </span>
                  <span className={css.label} data-visible={copy === 'copied'} aria-hidden={copy !== 'copied'}>
                    {t('action.copied')}
                  </span>
                  <span className={css.label} data-visible={copy === 'failed'} aria-hidden={copy !== 'failed'}>
                    {t('action.copyFailed')}
                  </span>
                </span>
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              data-dsh-part={PART_REFRESH}
              disabled={state.kind === 'reading'}
              icon={<IconRefreshOutlineRegular />}
              onClick={onRefresh}
            >
              {primaryLabel}
            </Button>
          </footer>
        )}

        {/* Renaming the button under the pointer is not announced: a control's
            label is reported when focus lands on it, not when it changes. The
            outcome is said once from this region instead, and said as nothing
            while there is no outcome to report. */}
        <div className={css.announce} role="status">
          {copy === 'copied' && t('action.copied')}
          {copy === 'failed' && t('action.copyFailed')}
        </div>
      </div>
    </Modal>
  )
}
