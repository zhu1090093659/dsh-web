import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { QUESTION_CLAIM_GRACE_MS, type BridgeHub } from '../src/core/hub.ts'
import { MINOR } from '../src/core/protocol.ts'
import { UI_HTML_MAX_BYTES, UI_PAYLOAD_MAX_BYTES } from '../src/core/ui.ts'
import { createUiPresentTool } from '../src/host/ui-tools.ts'
import { answerOf, makeBareHub, makeHub, RecordingTransport, requestFrame, settle } from './support/harness.ts'

/** One whole self-contained document, the shape §35.2 requires of `html`. */
const PAGE = '<!doctype html><html><body><button id="go">Alpha</button></body></html>'

/** The host ToolCallId every presentation in this suite runs under. */
const CALL_ID = 'tc-1'
/** The session whose agent presented it. */
const SESSION_ID = 's-1'
/** The card identity the client knows it by (`"<sessionId>/<callId>"`, §35.4). */
const KEY = SESSION_ID + '/' + CALL_ID

/** Declare the card channel on one connection, the way a phone greets. */
async function declareUi(connection: { handleText(text: string): Promise<void> }, id = 1, cap = ['ui.v1', 'ui.list.v1']): Promise<void> {
  await connection.handleText(requestFrame(id, 'hello', { proto: 1, cap }))
}

/**
 * One tool call's execution context, as the registry hands it to `execute`.
 *
 * Only the three fields this tool reads are modelled: the call id the host
 * assigned that call (`ToolExecutionInput.callId: ToolCallId`), the calling agent
 * (whose id IS the session id) and the caller's cancellation signal.
 * @param signal - the agent's own lifetime for the call.
 */
function execOf(signal?: AbortSignal): never {
  return {
    callId: CALL_ID,
    agent: { id: SESSION_ID },
    signal: signal ?? new AbortController().signal,
  } as never
}

/** The `ui_present` definition over one hub, exactly as the plugin mounts it. */
function toolOf(harness: { hub: BridgeHub }): ToolDefinition {
  return createUiPresentTool({ present: async (card, signal) => await harness.hub.present(card, signal) })
}

/** One presentation's canonical result, as the tool declared it. */
interface PresentValue {
  readonly ok: boolean
  readonly key?: string
  readonly delivered?: number
  readonly type?: string
  readonly payload?: unknown
  readonly reason?: string
}

/**
 * One tool call's canonical result.
 *
 * `ToolDefinition.execute` answers `unknown` because a registry validates it
 * against the declared schema, so the suite narrows it once here instead of at
 * every assertion.
 * @param pending - the call that is still waiting, or already settled.
 * @returns the canonical value.
 */
async function valueOf(pending: Promise<unknown>): Promise<PresentValue> {
  return await pending as PresentValue
}

/** @returns the payload of every `ui.request` frame the carrier took. */
function uiRequestPayloads(transport: RecordingTransport): Record<string, unknown>[] {
  return transport.ofType('ev')
    .filter(frame => frame.m === 'ui.request')
    .map(frame => frame.p as Record<string, unknown>)
}

/** Run one `ui.event` on a connection. */
async function act(connection: { handleText(text: string): Promise<void> }, id: number, event: Record<string, unknown>, callId = CALL_ID): Promise<void> {
  await connection.handleText(requestFrame(id, 'ui.event', { sessionId: SESSION_ID, callId, event }))
}

/** Run one `ui.list` on a connection. */
async function listCards(connection: { handleText(text: string): Promise<void> }, id: number): Promise<void> {
  await connection.handleText(requestFrame(id, 'ui.list', {}))
}

describe('interactive reply bridge', () => {
  afterEach(() => { vi.useRealTimers() })

  it('operator gets a tool whose name the model API accepts, so one bad name cannot fail every turn', () => {
    // Given the definition this plugin registers
    const tool = toolOf(makeHub())
    // When the name is checked against the pattern the request schema declares
    const accepted = /^[a-zA-Z0-9_-]+$/.test(tool.name)
    // Then it passes, so the whole tool list is not rejected
    expect(accepted).toBe(true)
  })

  it('user greets the bridge and reads the two card capabilities at the end of the served list', async () => {
    // Given a paired phone that declares the card channel and the reconciliation read
    const harness = makeHub()
    // When it greets the bridge
    await declareUi(harness.connection)
    // Then the greeting announces both names after every existing one, and the minor counts it
    const hello = answerOf(harness, 1).r as { minor: number; capabilities: string[] }
    expect(hello.minor).toBe(MINOR)
    // hello 的应答里新增两项能力名（§35.1）：既有项位置不动，两个新名字追加在末尾。
    expect(hello.capabilities.slice(-3)).toEqual(['ui.v1', 'ui.list.v1', 'session.attachment.path.v1'])
  })

  it('operator of a phone that declared ui.v1 is handed the whole page and the card stays held', async () => {
    // Given a paired phone that announced the channel
    const harness = makeHub()
    await declareUi(harness.connection)
    const tool = toolOf(harness)
    // When the agent presents one page
    const pending = tool.execute({ html: PAGE, title: 'Deck', height: 420 }, execOf())
    await settle()
    // Then the frame carries the frozen payload under the host's own tool call id
    const payload = uiRequestPayloads(harness.transport)[0]
    expect(payload).toEqual({
      sessionId: SESSION_ID,
      callId: CALL_ID,
      state: 'open',
      title: 'Deck',
      html: PAGE,
      height: 420,
    })
    expect(payload?.expiresAt).toBeUndefined()
    // And the card is held under that same id
    expect(harness.ui.size).toBe(1)
    expect(harness.ui.stateOf(CALL_ID)).toBe('open')
    // When the operator acts, the call ends rather than leaving the agent waiting
    await act(harness.connection, 2, { type: 'submit' })
    expect((await valueOf(pending)).ok).toBe(true)
  })

  it('operator acts inside the card and the structured event becomes the tool result', async () => {
    // Given a presented card
    const harness = makeHub()
    await declareUi(harness.connection)
    const tool = toolOf(harness)
    const pending = tool.execute({ html: PAGE, title: 'Deck' }, execOf())
    await settle()
    // When the user's first action arrives
    await act(harness.connection, 2, { type: 'submit', payload: { choice: 'alpha' } })
    // Then the client is acknowledged and the event is that call's own result
    expect(answerOf(harness, 2)).toEqual({ ok: true, r: { ok: true } })
    expect(await pending).toEqual({ ok: true, key: KEY, delivered: 1, type: 'submit', payload: { choice: 'alpha' } })
    // And the card is announced over: open first, settled after (§35.3)
    expect(uiRequestPayloads(harness.transport).map(entry => entry.state)).toEqual(['open', 'settled'])
    expect(harness.ui.size).toBe(0)
    expect(harness.ui.stateOf(CALL_ID)).toBe('settled')
  })

  it('user taps a settled card again and is told ui-settled rather than ui-unknown', async () => {
    // Given a card the user's own event already settled
    const harness = makeHub()
    await declareUi(harness.connection)
    const pending = toolOf(harness).execute({ html: PAGE }, execOf())
    await settle()
    await act(harness.connection, 2, { type: 'submit' })
    expect((await valueOf(pending)).ok).toBe(true)
    // When the same card reports a second action
    await act(harness.connection, 3, { type: 'submit' })
    // Then the answer is the one saying "already done", not "never mine"
    expect(answerOf(harness, 3).e?.code).toBe('ui-settled')
  })

  it('user acts on a call id this bridge never claimed and is told ui-unknown', async () => {
    // Given a phone that declared the channel and no card at all
    const harness = makeHub()
    await declareUi(harness.connection)
    // When it reports an action for a call id this bridge never presented
    await act(harness.connection, 2, { type: 'submit' }, 'never-presented')
    // Then the refusal names the card, not the method
    expect(answerOf(harness, 2).e?.code).toBe('ui-unknown')
    expect(harness.ui.size).toBe(0)
  })

  it('operator calls ui_present with nobody on the wire and the tool answers unavailable at once', async () => {
    // Given a bridge with no connection at all
    const bare = makeBareHub()
    const tool = createUiPresentTool({ present: async (card, signal) => await bare.hub.present(card, signal) })
    // When the agent presents a page
    const value = await tool.execute({ html: PAGE }, execOf())
    // Then the refusal is immediate, nothing is held and no frame exists to send
    expect(value).toEqual({ ok: false, reason: 'unavailable' })
    expect(bare.ui.size).toBe(0)
  })

  it('operator calls ui_present for a paired client that never declared the channel and the tool answers unavailable', async () => {
    // Given a paired phone that declared an unrelated channel only
    const harness = makeHub()
    await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: ['questions.v1'] }))
    // When the agent presents a page
    const value = await toolOf(harness).execute({ html: PAGE }, execOf())
    // Then nobody can be shown it, so the agent is not made to wait (§35.6)
    expect(value).toEqual({ ok: false, reason: 'unavailable' })
    expect(uiRequestPayloads(harness.transport)).toEqual([])
    expect(harness.ui.size).toBe(0)
  })

  it('operator calls ui_present with a page over the cap and the tool refuses invalid-args without a frame', async () => {
    // Given a page one byte past the 256 KiB cap
    const harness = makeHub()
    await declareUi(harness.connection)
    const tool = toolOf(harness)
    const html = 'x'.repeat(UI_HTML_MAX_BYTES + 1)
    // When the agent presents it
    const value = await tool.execute({ html }, execOf())
    // Then the refusal happens on this side: no frame, no card, no presentation payload
    expect(value).toEqual({ ok: false, reason: 'invalid-args' })
    expect(uiRequestPayloads(harness.transport)).toEqual([])
    expect(harness.ui.size).toBe(0)
    expect(tool.output.presentationMeta?.({ html } as never, value as never)).toEqual({})
  })

  it('user sends an action whose payload is over 8 KiB and the card is refused invalid-args', async () => {
    // Given a presented card
    const harness = makeHub()
    await declareUi(harness.connection)
    const pending = toolOf(harness).execute({ html: PAGE }, execOf())
    await settle()
    // When one action carries more than the cap allows
    await act(harness.connection, 2, { type: 'submit', payload: 'x'.repeat(UI_PAYLOAD_MAX_BYTES) })
    // Then the frame is refused and the card is untouched
    expect(answerOf(harness, 2).e?.code).toBe('invalid-args')
    expect(harness.ui.size).toBe(1)
    // And an action within the cap still settles it
    await act(harness.connection, 3, { type: 'submit' })
    expect((await valueOf(pending)).ok).toBe(true)
  })

  it('user reconciles the cards it holds and reads only the open ones, with the read changing nothing', async () => {
    // Given a presented card
    const harness = makeHub()
    await declareUi(harness.connection)
    const pending = toolOf(harness).execute({ html: PAGE, title: 'Deck' }, execOf())
    await settle()
    // When the client asks what this bridge still holds
    await listCards(harness.connection, 2)
    // Then the card is one row whose key and payload match the frame it was handed
    const opened = uiRequestPayloads(harness.transport)[0]
    expect(answerOf(harness, 2).r).toEqual({
      cards: [{ key: KEY, sessionId: SESSION_ID, state: 'open', payload: opened }],
      complete: true,
    })
    // And the read claimed nothing: the card still settles through its own event
    expect(harness.ui.size).toBe(1)
    await act(harness.connection, 3, { type: 'submit' })
    expect((await valueOf(pending)).ok).toBe(true)
    // When it asks again after the card ended
    await listCards(harness.connection, 4)
    // Then a settled card is not a row: the list's definition is "still held"
    expect(answerOf(harness, 4).r).toEqual({ cards: [], complete: true })
  })

  it('operator reads the settled card from meta.ui, keyed by the host tool call id', async () => {
    // Given a card that settled through the user's action
    const harness = makeHub()
    await declareUi(harness.connection)
    const tool = toolOf(harness)
    const args = { html: PAGE, title: 'Deck', height: 420 }
    const pending = tool.execute(args, execOf())
    await settle()
    const opened = uiRequestPayloads(harness.transport)[0]
    // When the phone settles the card with its first event
    await act(harness.connection, 2, { type: 'choose', payload: { deck: 'alpha' } })
    const value = await pending
    // Then the frame names the host's own ToolCallId, never an id this bridge minted
    expect(opened?.callId).toBe(CALL_ID)
    // And the result body is one sentence rather than the page
    expect(tool.output.render(args as never, value as never)).toEqual([
      { type: 'text', text: 'presented to 1 paired client(s); settled by the operator with "choose"' },
    ])
    // And the presentation payload rides meta, under the same key spelling
    const meta = tool.output.presentationMeta?.(args as never, value as never) as { ui: Record<string, unknown> }
    expect(meta).toEqual({
      ui: { key: KEY, title: 'Deck', html: PAGE, height: 420, state: 'settled' },
    })
    expect(meta.ui.key).toBe(SESSION_ID + '/' + String(opened?.callId))
  })

  it('operator loses the last phone and the card the window releases still carries meta.ui', async () => {
    // Given a presented card whose only phone is about to go away
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const harness = makeHub()
    await declareUi(harness.connection)
    const tool = toolOf(harness)
    const args = { html: PAGE, title: 'Deck' }
    const pending = tool.execute(args, execOf())
    await settle()
    // When the connection closes and the grace window runs out
    harness.hub.detach(harness.connection)
    await vi.advanceTimersByTimeAsync(QUESTION_CLAIM_GRACE_MS)
    // Then the call ends as a release the host side reads as a timeout (§35.5)
    const value = await pending
    expect(value).toEqual({ ok: false, reason: 'timeout', key: KEY, delivered: 1 })
    expect(harness.ui.size).toBe(0)
    expect(harness.logs).toContain('1 presented page(s) released: the grace window ended')
    // And the card that did reach the wire still carries its presentation payload
    expect(tool.output.presentationMeta?.(args as never, value as never)).toEqual({
      ui: { key: KEY, title: 'Deck', html: PAGE, state: 'settled' },
    })
  })

  it('operator reconnects and the card the bridge still holds is replayed to it', async () => {
    // Given a card presented while the first phone was connected
    const harness = makeHub()
    await declareUi(harness.connection)
    const pending = toolOf(harness).execute({ html: PAGE, title: 'Deck' }, execOf())
    await settle()
    const first = uiRequestPayloads(harness.transport)[0]
    // When a second paired client declares the channel
    const transport = new RecordingTransport()
    const second = harness.hub.attach(transport, { deviceId: 'dev_second' })
    await declareUi(second, 1, ['ui.v1'])
    // Then it is handed the live card, byte for byte, without a second claim
    expect(uiRequestPayloads(transport)).toEqual([first])
    expect(harness.ui.size).toBe(1)
    // And its action settles the one call that presented it
    await act(second, 2, { type: 'submit' })
    expect(await pending).toEqual({ ok: true, key: KEY, delivered: 1, type: 'submit' })
  })

  it('operator brings the phone back inside the grace window and the release it was held for is cancelled', async () => {
    // Given a card presented to the only phone on the wire
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const harness = makeHub()
    await declareUi(harness.connection)
    const pending = toolOf(harness).execute({ html: PAGE }, execOf())
    await settle()
    // When that phone leaves and another declares the channel before the window ends
    harness.hub.detach(harness.connection)
    const transport = new RecordingTransport()
    const back = harness.hub.attach(transport, { deviceId: 'dev_back' })
    await declareUi(back, 1, ['ui.v1'])
    await vi.advanceTimersByTimeAsync(QUESTION_CLAIM_GRACE_MS)
    // Then the card is still held: the window was cancelled, not shortened (§11.5, §35.5)
    expect(harness.ui.size).toBe(1)
    // And the phone that came back is the one that settles it
    await act(back, 2, { type: 'run' })
    expect(await pending).toEqual({ ok: true, key: KEY, delivered: 1, type: 'run' })
  })

  it('operator cancels the agent turn and the card is released without inventing an action', async () => {
    // Given a presented card and the tool call's own cancellation lifetime
    const harness = makeHub()
    await declareUi(harness.connection)
    const controller = new AbortController()
    const pending = toolOf(harness).execute({ html: PAGE }, execOf(controller.signal))
    await settle()
    // When the turn is cancelled
    controller.abort(new Error('the turn was cancelled'))
    // Then the call ends as a refusal, never as a decision the operator did not make
    expect(await pending).toEqual({ ok: false, reason: 'cancelled', key: KEY, delivered: 1 })
    expect(harness.ui.size).toBe(0)
    // And the phone is told its card is over
    expect(uiRequestPayloads(harness.transport).map(entry => entry.state)).toEqual(['open', 'settled'])
  })
})
