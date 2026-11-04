// @vitest-environment jsdom
/**
 * The pairing panel: the symbol and the single machine string it carries, the
 * countdown and the expiry state, the address line, the single-use hint, the
 * action row, and the three refusals. Pure presentation — the clock arrives as a
 * prop, so the expiry flip is a value, not a wait. The address line is asserted
 * both ways: what it says, and the public hostname it must never say.
 *
 * The panel's shell is the official Modal and its actions are the official
 * Button, so the primitive components are replaced by contract fakes: the real
 * ones import CSS modules a node test runner cannot load (the sibling card
 * suites fake them for the same reason). The fakes keep the contract this panel
 * depends on — a labelled dialog that renders nothing while closed, Escape as
 * the close command, a native button carrying its label, variants and disabled
 * state — and the component under test stays the real one.
 *
 * test-standards-allow: no-ad-hoc-mock - only the SDK primitive components are
 * replaced; the panel, its state handling and its copy are the real code.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => {
  const create = (React.createElement as (...args: unknown[]) => unknown).bind(React)
  /** A native button exposing the library contract the panel passes down. */
  const Button = (props: Record<string, unknown>) => create('button', {
    type: 'button',
    className: props['className'],
    disabled: props['disabled'],
    onClick: props['onClick'],
    'aria-label': props['aria-label'],
    'data-dsh-part': props['data-dsh-part'],
    'data-variant': props['variant'],
    'data-size': props['size'],
  }, props['icon'], props['children'])
  /** The dialog contract: labelled while open, Escape closes, nothing while closed. */
  const Modal = (props: Record<string, unknown>) => {
    React.useEffect(() => {
      if (props['open'] !== true) return undefined
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') (props['onClose'] as () => void)()
      }
      document.addEventListener('keydown', onKey)
      return () => { document.removeEventListener('keydown', onKey) }
    }, [props['open'], props['onClose']])
    if (props['open'] !== true) return null
    return create('div', {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': props['title'],
      className: props['className'],
    }, props['children'])
  }
  const glyph = (name: string) => (props: Record<string, unknown>) =>
    create('span', { 'data-icon': name, 'aria-hidden': 'true', className: props['className'] })
  return {
    Button,
    Modal,
    IconCloseOutlineRegular: glyph('close'),
    IconCopyOutlineRegular: glyph('copy'),
    IconCheckOutlineRegular: glyph('check'),
    IconRefreshOutlineRegular: glyph('refresh'),
    IconWarningOutlineRegular: glyph('warning'),
  }
})

import { COMMUNITY_INVITE_URL, PairPanel, type PairCopyState, type PairPanelState } from '../src/client/PairPanel.tsx'
import type { PairOriginSource } from '../src/core/pair-address.ts'
import { en, zh, type RemoteBridgeKey } from '../src/client/locales.ts'

/** Translate stub over the zh dictionary, with {param} interpolation. */
function makeTranslate(): PropsLocale<'remote-bridge'>['t'] {
  return (key, params) => {
    let text: string = zh[key as RemoteBridgeKey] ?? key
    for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
    return text
  }
}

/** The page's own host:port, as the address warning names it. */
const HOST = '127.0.0.1:19398'
/** The bare one-shot secret the panel shows when no origin was located. */
const TOKEN = 'Kq7xTt2mRw9vLpB4nJcH5sYzA1eU8gFoI3dXbN0rQ6w'
/** The {token,url} document a host that knows its public origin hands back. */
const ORIGIN = 'wss://abc.dsh-market.com'
const PAYLOAD_URL = `{"token":"${TOKEN}","url":"${ORIGIN}/ios/v1?token=${TOKEN}"}`
/** The read that minted the code, and the 30 s window it lives for. */
const ISSUED_AT = 1_000_000
const WINDOW_MS = 30_000

/** A live code with the given origin knowledge; an unnamed source counts as public. */
function liveCode(
  origin: string | null,
  pairingUrl: string | null,
  originSource: PairOriginSource | null = null,
): PairPanelState {
  return {
    kind: 'ready',
    token: TOKEN,
    issuedAt: ISSUED_AT,
    expiresAt: ISSUED_AT + WINDOW_MS,
    origin,
    originSource,
    pairingUrl,
  }
}

/**
 * The panel's markup with the symbol's own part removed. The symbol is the one
 * part allowed to mirror the payload — the contract says so — so a public
 * hostname anywhere else in the markup, text or attribute, is a leak the panel
 * must not have.
 */
function markupWithoutSymbol(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement
  clone.querySelector('[data-dsh-part="qr"]')?.remove()
  return clone.innerHTML
}

/** Render the panel in one state and return the DOM. */
function mount(state: PairPanelState, options: { now?: number; copy?: PairCopyState } = {}) {
  return render(
    <PairPanel
      id="pair-panel"
      t={makeTranslate()}
      state={state}
      now={options.now ?? ISSUED_AT}
      host={HOST}
      copy={options.copy ?? 'idle'}
      showing
      closing={false}
      onClose={() => undefined}
      onExited={() => undefined}
      onRefresh={() => undefined}
      onCopy={() => undefined}
    />,
  )
}

afterEach(() => {
  cleanup()
})

describe('protocol v1 pairing panel', () => {
  it('operator sees the live code in the QR symbol and nowhere else', () => {
    // Given a live code on screen
    const panel = mount(liveCode(null, null))
    // When the reader looks for the secret
    const qr = panel.container.querySelector('[data-dsh-part="qr"]')
    // Then the symbol carries it once, as a bare token, and no plaintext copy of it
    // is rendered anywhere else on the panel
    expect(qr?.getAttribute('data-dsh-qr-value')).toBe(TOKEN)
    expect(qr?.hasAttribute('data-expired')).toBe(false)
    expect(panel.container.textContent).not.toContain(TOKEN)
    expect(panel.container.querySelector('[data-dsh-part="token"]')).toBeNull()
    expect(/^(?:wss?|https?):/.test(qr?.getAttribute('data-dsh-qr-value') ?? '')).toBe(false)
  })

  it('operator sees the countdown while the code is live and the expiry sentence after the deadline', () => {
    // Given a code minted at t=1_000_000 with a 30 s window
    const state = liveCode(null, null)
    // When the panel renders one second in, then one second past the deadline
    const live = mount(state, { now: ISSUED_AT + 1_000 })
    // Then the live render counts down and the past-deadline render states the
    // expiry outright, on the same symbol
    expect(screen.getByText('剩余 29 秒')).toBeInstanceOf(HTMLElement)
    expect(live.container.querySelector('[data-dsh-part="qr"]')?.hasAttribute('data-expired')).toBe(false)
    cleanup()
    const dead = mount(state, { now: ISSUED_AT + WINDOW_MS + 1_000 })
    expect(screen.getByText(zh['pair.expired'])).toBeInstanceOf(HTMLElement)
    expect(screen.queryByText('剩余 29 秒')).toBeNull()
    expect(dead.container.querySelector('[data-dsh-part="qr"]')?.hasAttribute('data-expired')).toBe(true)
  })

  it('operator waiting for a code sees the symbol card, not a line of text in its place', () => {
    // Given a read that has not answered yet
    const reading = mount({ kind: 'reading' })
    // When the panel renders
    const slot = reading.container.querySelector('[data-dsh-part="qr"]')
    // Then the card and the symbol's own box are already there, holding a
    // placeholder instead of the symbol
    expect(screen.getByText(zh['state.reading'])).toBeInstanceOf(HTMLElement)
    expect(slot).toBeInstanceOf(HTMLElement)
    expect(slot?.querySelector('svg')).toBeNull()
  })

  it('operator on a host that knows its public address is told what the code carries, and the hostname stays off the panel', () => {
    // Given a host that located its public relay origin and handed back the code for it
    const panel = mount(liveCode(ORIGIN, PAYLOAD_URL, 'realtime'))
    // When the panel renders
    const qr = panel.container.querySelector('[data-dsh-part="qr"]')
    // Then the symbol still carries the whole {token,url} document so one scan sets
    // both halves, while the durable public hostname is nowhere in the rendered text
    expect(qr?.getAttribute('data-dsh-qr-value')).toBe(PAYLOAD_URL)
    expect(panel.container.textContent).toContain(zh['origin.public'])
    expect(panel.container.textContent).not.toContain(ORIGIN)
    expect(panel.container.textContent).not.toContain('dsh-market.com')
    expect(panel.container.querySelector('[data-tone="plain"]')?.textContent).toBe(zh['origin.public'])
    // And nothing outside the symbol carries it either: a title, an aria-label or
    // a data attribute added later would leak just as a sentence does
    expect(markupWithoutSymbol(panel.container)).not.toContain(ORIGIN)
    expect(markupWithoutSymbol(panel.container)).not.toContain('dsh-market.com')
  })

  it('operator on a host that located its address by configuration reads the same line as a live one', () => {
    // Given each way a host can name a public origin without a LAN literal
    for (const source of ['realtime', 'env'] as const) {
      // When the panel renders
      const panel = mount(liveCode(ORIGIN, PAYLOAD_URL, source))
      // Then both read as the public kind, and neither prints the hostname
      expect(panel.container.querySelector('[data-tone="plain"]')?.textContent).toBe(zh['origin.public'])
      expect(markupWithoutSymbol(panel.container)).not.toContain('dsh-market.com')
      cleanup()
    }
  })

  it('operator on a configured base that is a private address is shown that literal', () => {
    // Given a host that called its configured base public while the address itself
    // answers only inside this network
    const lan = 'http://192.168.1.5:3080'
    const panel = mount(liveCode(lan, `ws://192.168.1.5:3080/ios/v1?token=${TOKEN}`, 'env'))
    // When the panel renders its address line
    // Then the literal decides the kind, not the host's own word for it
    const address = panel.container.querySelector('[data-tone="plain"]')
    expect(address?.textContent).toBe(zh['origin.lan'].replace('{origin}', lan))
    expect(panel.container.textContent).not.toContain(zh['origin.public'])
  })

  it('operator on a host whose address source this panel does not know still reads no hostname', () => {
    // Given a code whose host named no source: an older host, or one this panel
    // has never heard of
    const panel = mount(liveCode(ORIGIN, PAYLOAD_URL))
    // When the panel renders its address line
    // Then an unknown source is treated as public rather than printed
    expect(panel.container.textContent).toContain(zh['origin.public'])
    expect(panel.container.textContent).not.toContain(ORIGIN)
    expect(markupWithoutSymbol(panel.container)).not.toContain(ORIGIN)
  })

  it('operator on a host whose only address is the local network is shown that literal', () => {
    // Given a LAN origin, which only a phone on the same network can dial
    const lan = 'http://192.168.1.5:3080'
    const panel = mount(liveCode(lan, `ws://192.168.1.5:3080/ios/v1?token=${TOKEN}`, 'lan'))
    // When the panel renders its address line
    // Then it names that literal, because a private address answers only inside the
    // network this page is already on
    const address = panel.container.querySelector('[data-tone="plain"]')
    expect(address?.textContent).toBe(zh['origin.lan'].replace('{origin}', lan))
    // And the public kind is not stated anywhere beside it
    expect(panel.container.textContent).not.toContain(zh['origin.public'])
  })

  it('operator on a host without a public address is told to fill the relay in by hand', () => {
    // Given a code minted without an origin
    const panel = mount(liveCode(null, null))
    // When the panel renders the address line
    const address = panel.container.querySelector('[data-tone="warning"]')
    // Then it names the missing address, the hand-filled relay, and why this page
    // cannot be the address the phone uses
    expect(address?.textContent).toContain('没有找到公网地址')
    expect(address?.textContent).toContain('公网中继')
    expect(address?.textContent).toContain(HOST)
    expect(address?.textContent).toContain('只有本机能连')
  })

  it('operator sees the single-use hint under the code', () => {
    // Given a live code
    const panel = mount(liveCode(null, null))
    // When the panel renders its supporting group
    // Then the one-shot rule is on screen instead of only in the README
    expect(panel.container.textContent).toContain(zh['pair.usedHint'])
  })

  it('operator can copy a live code and cannot copy an expired one', () => {
    // Given a live code, then the same code past its deadline
    const live = mount(liveCode(null, null))
    // When each render's copy action is looked up by the name it offers
    const liveCopy = within(live.container).getByRole('button', { name: zh['action.copy'] })
    // Then copy follows the deadline instead of handing out a dead string: the
    // action is there in both renders, and only its availability moves
    expect(liveCopy.hasAttribute('disabled')).toBe(false)
    cleanup()
    const dead = mount(liveCode(null, null), { now: ISSUED_AT + WINDOW_MS + 1_000 })
    const deadCopy = within(dead.container).getByRole('button', { name: zh['action.copy'] })
    expect(deadCopy.hasAttribute('disabled')).toBe(true)
  })

  it('operator in a state with no code on screen is offered no copy action at all', () => {
    // Given the four states that hold no secret to hand out
    const states: PairPanelState[] = [
      { kind: 'reading' },
      { kind: 'forbidden' },
      { kind: 'failed', status: 500 },
      { kind: 'unreachable' },
    ]
    for (const state of states) {
      // When each renders
      const panel = mount(state)
      // Then there is no copy action to press, not even a switched-off one: an
      // action that cannot run is not on screen to be read or tabbed to
      expect(within(panel.container).queryByRole('button', { name: zh['action.copy'] })).toBeNull()
      expect(panel.container.querySelector('[data-dsh-part="copy"]')).toBeNull()
      cleanup()
    }
  })

  it('operator hears the copy outcome from a live region that is silent while idle', () => {
    // Given a live code whose copy has not been attempted
    const idle = mount(liveCode(null, null))
    // When the panel's live region is read
    // Then it holds nothing, so no stale outcome is announced on open
    expect(within(idle.container).getByRole('status').textContent).toBe('')
    cleanup()
    // When the copy succeeded, then the write was refused
    const copied = mount(liveCode(null, null), { copy: 'copied' })
    const failed = mount(liveCode(null, null), { copy: 'failed' })
    // Then the same region carries each outcome in words, so the result is
    // spoken instead of only redrawn on the focused button
    expect(within(copied.container).getByRole('status').textContent).toBe(zh['action.copied'])
    expect(within(failed.container).getByRole('status').textContent).toBe(zh['action.copyFailed'])
  })

  it('operator asked to act again gets a new code from a live code and a retry from a refusal', () => {
    // Given a live code, then a host that never answered
    const live = mount(liveCode(null, null))
    // When each render's primary action is read
    const mintAgain = live.container.querySelector('[data-dsh-part="refresh"]')
    // Then a live code is replaced on demand, while a failed read is retried
    expect(mintAgain?.textContent).toContain(zh['pair.refresh'])
    cleanup()
    const failed = mount({ kind: 'failed', status: 500 })
    const retry = failed.container.querySelector('[data-dsh-part="refresh"]')
    expect(retry?.textContent).toContain(zh['action.retry'])
  })

  it('operator sees the three panel actions as library variants of one control', () => {
    // Given a live code on screen
    const panel = mount(liveCode(null, null))
    // When the actions are inspected
    const close = screen.getByRole('button', { name: zh['action.close'] })
    // Then close, copy and mint are all the official control, sized alike, with
    // the one filled primary for the action that replaces the code
    expect(close.getAttribute('data-variant')).toBe('ghost')
    expect(close.getAttribute('data-size')).toBe('sm')
    expect(panel.container.querySelector('[data-dsh-part="copy"]')?.getAttribute('data-variant')).toBe('outline')
    expect(panel.container.querySelector('[data-dsh-part="copy"]')?.getAttribute('data-size')).toBe('sm')
    expect(panel.container.querySelector('[data-dsh-part="refresh"]')?.getAttribute('data-variant')).toBe('primary')
    expect(panel.container.querySelector('[data-dsh-part="refresh"]')?.getAttribute('data-size')).toBe('sm')
  })

  it('operator whose copy succeeded sees the confirmation in the action label', () => {
    // Given a panel that has just copied the code
    const panel = mount(liveCode(null, null), { copy: 'copied' })
    // When the copy action is read back
    // Then its label and its glyph report the result in place
    expect(screen.getByRole('button', { name: zh['action.copied'] })).toBeInstanceOf(HTMLElement)
    expect(panel.container.querySelector('[data-dsh-part="copy"] [data-icon="check"]')).toBeInstanceOf(HTMLElement)
  })

  it('operator on a page that is not this machine is told why and is offered no new code', () => {
    // Given the loopback gate refused the read
    const panel = mount({ kind: 'forbidden' })
    // When the panel renders that state
    const alert = panel.container.querySelector('[data-dsh-part="notice"][role="alert"]')
    // Then it names the condition, offers no code, and offers nothing to press
    expect(alert?.textContent).toContain(zh['forbidden.title'])
    expect(alert?.textContent).toContain('http://127.0.0.1:<端口>')
    expect(panel.container.querySelector('[data-dsh-part="qr"]')).toBeNull()
    expect(panel.container.querySelector('[data-dsh-part="refresh"]')).toBeNull()
  })

  it('operator sees an unexpected status and an unreachable host as their own states', () => {
    // Given a host route that answered 500 and a request that never arrived
    const failed = mount({ kind: 'failed', status: 500 })
    // When each state renders
    const failedText = failed.container.querySelector('[data-dsh-part="notice"]')?.textContent ?? ''
    cleanup()
    const unreachable = mount({ kind: 'unreachable' })
    const unreachableText = unreachable.container.querySelector('[data-dsh-part="notice"]')?.textContent ?? ''
    // Then neither is silent, each names its own cause, and both are announced
    expect(failedText).toContain('宿主返回了 HTTP 500')
    expect(unreachableText).toContain('请求没有到达宿主')
    expect(unreachable.container.querySelector('[data-dsh-part="notice"]')?.getAttribute('role')).toBe('alert')
  })

  it('operator reads the beta framing of the iOS app on the head of the panel', () => {
    // Given a panel holding a live code
    const panel = mount(liveCode(null, null))
    // When the head is read
    // Then the title names the app and its platform, and the subtitle names the
    // beta the code is for, in the operator's words instead of the wire
    // protocol's
    expect(screen.getByText('iOS App 配对')).toBeInstanceOf(HTMLElement)
    expect(panel.container.textContent).toContain(
      '用 iOS App（内测）扫描二维码，把 iPhone 连到这台电脑上。配对码只在本机显示。',
    )
  })

  it('operator in every state is offered the same community invite as a real link', () => {
    // Given the five states the panel can hold: a read in flight, a live code,
    // and the three refusals
    const states: PairPanelState[] = [
      { kind: 'reading' },
      liveCode(null, null),
      { kind: 'forbidden' },
      { kind: 'failed', status: 500 },
      { kind: 'unreachable' },
    ]
    expect(COMMUNITY_INVITE_URL).toBe('https://discord.gg/nBy28kjun')
    for (const state of states) {
      // When each renders
      const panel = mount(state)
      const invite = within(panel.container).getByRole('link', { name: zh['community.invite'] })
      // Then the invitation is on screen in all of them, the sentence itself is
      // the target, it closes the body, and it leaves for the community in its
      // own tab without handing the opener over
      expect(invite.textContent).toBe(zh['community.invite'])
      expect(invite.getAttribute('href')).toBe(COMMUNITY_INVITE_URL)
      expect(invite.getAttribute('target')).toBe('_blank')
      expect(invite.getAttribute('rel')).toBe('noopener noreferrer')
      expect(invite.parentElement?.lastElementChild).toBe(invite)
      cleanup()
    }
  })

  it('operator reads no internal protocol wording in any state or dictionary entry', () => {
    // Given the five states the panel can hold
    const states: PairPanelState[] = [
      { kind: 'reading' },
      liveCode(null, null),
      { kind: 'forbidden' },
      { kind: 'failed', status: 500 },
      { kind: 'unreachable' },
    ]
    for (const state of states) {
      // When each renders
      const panel = mount(state)
      const text = panel.container.textContent ?? ''
      // Then no state names the wire protocol or its version marker
      expect(text).not.toContain('协议')
      expect(text.toLowerCase()).not.toContain('protocol')
      cleanup()
    }
    // And no key of either dictionary carries the term either, so a state added
    // later cannot bring it back through a sentence this suite never renders
    for (const [key, value] of Object.entries(zh)) {
      expect(value, key).not.toContain('协议')
      expect(value.toLowerCase(), key).not.toContain('protocol')
    }
    for (const [key, value] of Object.entries(en)) {
      expect(value.toLowerCase(), key).not.toContain('protocol')
    }
  })
})
