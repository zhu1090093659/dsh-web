// @vitest-environment jsdom
/**
 * The pairing seat's behavior: one read per open, mint-again, the 30 s expiry
 * flip, the copy action, the leave leg that keeps the card mounted until its
 * exit ends, and the refusals. The wire call and the clipboard arrive as
 * injected props (see src/client/index.ts), so these suites drive real component
 * state instead of patching a module or the global fetch.
 *
 * The modal the seat renders is the official Modal and its actions are the
 * official Button, whose CSS modules a node test runner cannot load, so the
 * primitives are replaced by contract fakes (the sibling card suites do the
 * same). The fake keeps the dialog contract this seat depends on: labelled while
 * open, nothing while closed, and Escape as the close command.
 *
 * test-standards-allow: no-ad-hoc-mock - only the SDK primitive components are
 * replaced; the seat, its presence state and its read/copy flow are the real code.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => {
  const create = (React.createElement as (...args: unknown[]) => unknown).bind(React)
  const Button = (props: Record<string, unknown>) => create('button', {
    type: 'button',
    className: props['className'],
    disabled: props['disabled'],
    onClick: props['onClick'],
    'aria-label': props['aria-label'],
    'data-dsh-part': props['data-dsh-part'],
  }, props['icon'], props['children'])
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

import { PairEntry } from '../src/client/PairEntry.tsx'
import type { PairTokenOutcome } from '../src/client/pair-token.ts'
import { zh, type RemoteBridgeKey } from '../src/client/locales.ts'

/** Translate stub over the zh dictionary, with {param} interpolation. */
function makeTranslate(): PropsLocale<'remote-bridge'>['t'] {
  return (key, params) => {
    let text: string = zh[key as RemoteBridgeKey] ?? key
    for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
    return text
  }
}

const t = makeTranslate()

/** A reader that answers the given codes in order, each with a 30 s window. */
function makeReader(tokens: readonly string[]) {
  let served = 0
  return {
    read: async (): Promise<PairTokenOutcome> => {
      const token = tokens[Math.min(served, tokens.length - 1)] ?? ''
      served += 1
      // No origin in this stub: the entry's own flow is what is under test here,
      // and the origin-bearing code has its own cases in the panel and reader specs.
      return { kind: 'ok', token, expiresAt: Date.now() + 30_000, origin: null, originSource: null, pairingUrl: null }
    },
    served: () => served,
  }
}

/** A clipboard that records what it was handed and reports success. */
function makeCopier() {
  const written: string[] = []
  return {
    copy: async (text: string): Promise<boolean> => {
      written.push(text)
      return true
    },
    written,
  }
}

/** Mount the seat and open the panel. */
async function open(readPairToken: () => Promise<PairTokenOutcome>, copy: (text: string) => Promise<boolean>) {
  const seat = render(<PairEntry wide read={readPairToken} copy={copy} t={t} />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: zh['entry.label'] })))
  return { seat, trigger: screen.getByRole('button', { name: zh['entry.label'] }) }
}

/** The panel root, if the modal is on screen. */
function panel(): HTMLElement | null {
  return document.querySelector('[data-dsh-part="panel"]')
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('protocol v1 pairing seat', () => {
  it('operator opens the seat and the one code lands in the symbol', async () => {
    // Given a footer seat whose reader answers one code
    const reader = makeReader(['token-one'])
    const { trigger } = await open(reader.read, makeCopier().copy)
    // When the panel has settled
    // Then that one code is in the symbol, the seat read exactly once, and the
    // trigger reports both what it expanded and what it controls
    expect(reader.served()).toBe(1)
    expect(document.querySelector('[data-dsh-part="qr"]')?.getAttribute('data-dsh-qr-value')).toBe('token-one')
    expect(document.body.textContent).not.toContain('token-one')
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById(trigger.getAttribute('aria-controls') ?? '')).toBe(panel())
  })

  it('operator asks for a new code and only the new one stays on screen', async () => {
    // Given an open panel holding the first code
    const reader = makeReader(['token-one', 'token-two'])
    await open(reader.read, makeCopier().copy)
    expect(document.querySelector('[data-dsh-part="qr"]')?.getAttribute('data-dsh-qr-value')).toBe('token-one')
    // When the operator presses the mint-again action
    await act(async () => fireEvent.click(screen.getByRole('button', { name: zh['pair.refresh'] })))
    // Then a second read happened and the previous code is gone
    expect(reader.served()).toBe(2)
    expect(document.querySelector('[data-dsh-part="qr"]')?.getAttribute('data-dsh-qr-value')).toBe('token-two')
  })

  it('operator keeps the panel past the deadline and the code reads as expired', async () => {
    // Given a live countdown on a 30 s code
    vi.useFakeTimers()
    const reader = makeReader(['token-one'])
    await open(reader.read, makeCopier().copy)
    expect(screen.getByText('剩余 30 秒')).toBeInstanceOf(HTMLElement)
    // When the clock passes the deadline
    await act(async () => { vi.advanceTimersByTime(31_000) })
    // Then the expiry state replaces the countdown, the symbol is marked expired,
    // and the only action left that can produce a scannable code is mint-again
    expect(screen.getByText(zh['pair.expired'])).toBeInstanceOf(HTMLElement)
    expect(screen.queryByText('剩余 30 秒')).toBeNull()
    expect(document.querySelector('[data-dsh-part="qr"]')?.hasAttribute('data-expired')).toBe(true)
    expect(document.querySelector('[data-dsh-part="copy"]')?.hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: zh['pair.refresh'] })).toBeInstanceOf(HTMLElement)
  })

  it('operator copies the code and the action confirms it in place', async () => {
    // Given an open panel holding a code
    const reader = makeReader(['token-one'])
    const clipboard = makeCopier()
    await open(reader.read, clipboard.copy)
    // When the operator presses copy
    await act(async () => fireEvent.click(screen.getByRole('button', { name: zh['action.copy'] })))
    // Then the clipboard got the same string the symbol encodes, and the action
    // says so where the copy label was
    expect(clipboard.written).toEqual(['token-one'])
    expect(screen.getByRole('button', { name: zh['action.copied'] })).toBeInstanceOf(HTMLElement)
  })

  it('operator copies the one-scan code when the host located its own address', async () => {
    // Given a host that answered with the link a phone adopts in one scan
    const payload = 'wss://abc.dsh-market.com/ios/v1?token=token-one'
    const read = async (): Promise<PairTokenOutcome> => ({
      kind: 'ok',
      token: 'token-one',
      expiresAt: Date.now() + 30_000,
      origin: 'wss://abc.dsh-market.com',
      originSource: 'realtime',
      pairingUrl: payload,
    })
    const clipboard = makeCopier()
    await open(read, clipboard.copy)
    // When the operator presses copy
    await act(async () => fireEvent.click(screen.getByRole('button', { name: zh['action.copy'] })))
    // Then the clipboard got the very document the symbol carries, address included,
    // so a paste configures the phone's origin as well as its code
    expect(clipboard.written).toEqual([payload])
    expect(document.querySelector('[data-dsh-part="qr"]')?.getAttribute('data-dsh-qr-value')).toBe(payload)
  })

  it('operator closes the panel and the card leaves before it unmounts', async () => {
    // Given an open panel
    vi.useFakeTimers()
    const reader = makeReader(['token-one'])
    const { trigger } = await open(reader.read, makeCopier().copy)
    // When the operator presses Escape
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
    // Then the card is still mounted for its exit and marked as leaving
    expect(panel()?.hasAttribute('data-closing')).toBe(true)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    // When the exit leg ends
    await act(async () => { vi.advanceTimersByTime(400) })
    // Then the modal is gone and the trigger reports the closed state
    expect(panel()).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(trigger.hasAttribute('aria-controls')).toBe(false)
  })

  it('operator on a page that is not this machine sees the refusal and no retry action', async () => {
    // Given a page the loopback gate refuses
    const read = async (): Promise<PairTokenOutcome> => ({ kind: 'forbidden' })
    await open(read, makeCopier().copy)
    // When the panel settled on that answer
    // Then the refusal is stated, no code is shown, and minting again is not offered
    expect(screen.getByText(zh['forbidden.title'])).toBeInstanceOf(HTMLElement)
    expect(document.querySelector('[data-dsh-part="qr"]')).toBeNull()
    expect(screen.queryByRole('button', { name: zh['pair.refresh'] })).toBeNull()
  })

  it('operator whose host never answered sees the unreachable state and can retry', async () => {
    // Given a page that cannot reach its host
    const read = async (): Promise<PairTokenOutcome> => ({ kind: 'unreachable' })
    await open(read, makeCopier().copy)
    // When the panel settled on that answer
    // Then the network failure is named rather than swallowed, and a retry is offered
    expect(screen.getByText(zh['unreachable.title'])).toBeInstanceOf(HTMLElement)
    expect(screen.getByRole('button', { name: zh['action.retry'] })).toBeInstanceOf(HTMLElement)
  })
})
