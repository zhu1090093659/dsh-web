import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApprovalRegistry } from '../src/core/approvals.ts'
import { IDLE_PING_MS } from '../src/core/connection.ts'
import { approvalSummary, type ApprovalRequestLike } from '../src/core/hub.ts'
import { answerOf, makeBareHub, makeConnection, makeHub, RecordingTransport, requestFrame, settle } from './support/harness.ts'

/** The one approval question a hub published, as a phone reads it. */
function publishedQuestion(transport: RecordingTransport): { sessionId: string; id: string; summary: string; toolName: string } {
  const frame = transport.ofType('ev').find(candidate => candidate.m === 'approval.request')
  if (frame === undefined) throw new Error('no approval question was published')
  return frame.p as { sessionId: string; id: string; summary: string; toolName: string }
}

/** One pending approval as the host's waterfall carries it. */
function hostApproval(overrides: Partial<ApprovalRequestLike> = {}): ApprovalRequestLike {
  return { agent: { id: 's-1' }, toolName: 'bash', displayReason: { en: 'run a command', zh: '运行命令' }, ...overrides }
}

/** The next answerer when the bridge delegates: the fail-closed default. */
const unavailable = async (): Promise<'unavailable'> => 'unavailable'

/** Declare the approval capability on one connection. */
async function declareApprovals(connection: { handleText(text: string): Promise<void> }, id = 1): Promise<void> {
  await connection.handleText(requestFrame(id, 'hello', { proto: 1, cap: ['approvals.v1'] }))
}

/**
 * Let `ms` of fake time pass while the phone answers every liveness ping.
 *
 * The bridge tears a connection down when a ping's deadline passes unanswered,
 * so a test about anything else has to model a phone that answers.
 */
async function liveFor(connection: { handleText(text: string): Promise<void> }, ms: number): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += IDLE_PING_MS) {
    await vi.advanceTimersByTimeAsync(Math.min(IDLE_PING_MS, ms - elapsed))
    await connection.handleText(JSON.stringify({ t: 'pong', ts: elapsed }))
  }
}

/** @returns the payload of every `approval.request` frame the carrier took. */
function approvalPayloads(transport: RecordingTransport): Record<string, unknown>[] {
  return transport.ofType('ev').filter(frame => frame.m === 'approval.request').map(frame => frame.p as Record<string, unknown>)
}

describe('approval bridge', () => {
  afterEach(() => { vi.useRealTimers() })

  it('operator claims a question and answers it exactly once', async () => {
    // Given a registry with one open question
    const registry = new ApprovalRegistry({ random: () => 'q-1' })
    const prompt = registry.open({ sessionId: 's-1', toolName: 'bash', summary: 'run a command' })
    // When it is answered twice
    const first = registry.resolve('q-1', 'allowed-once')
    const second = registry.resolve('q-1', 'rejected')
    // Then the first answer settles the question and the second finds nothing to settle
    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(await prompt.answer).toBe('allowed-once')
    expect(registry.size).toBe(0)
  })

  it('operator never answers and the question is delegated when its timeout elapses', async () => {
    // Given a claimed question whose phone goes quiet
    vi.useFakeTimers()
    const registry = new ApprovalRegistry({ timeoutMs: 120_000, random: () => 'q-2' })
    const prompt = registry.open({ sessionId: 's-1', toolName: 'bash', summary: 'run a command' })
    // When the timeout elapses
    await vi.advanceTimersByTimeAsync(120_000)
    // Then the answer is withdrawal, which the Host reads as the fail-closed unavailable
    expect(await prompt.answer).toBeUndefined()
    expect(registry.size).toBe(0)
  })

  it('operator cancels the agent turn and the question is withdrawn before its timeout', async () => {
    // Given a claimed question and the agent's own cancellation lifetime
    const controller = new AbortController()
    const registry = new ApprovalRegistry({ random: () => 'q-3' })
    const prompt = registry.open({ sessionId: 's-1', toolName: 'bash', summary: 'run a command', signal: controller.signal })
    // When the asker withdraws
    controller.abort()
    // Then the question settles immediately
    expect(await prompt.answer).toBeUndefined()
    expect(registry.size).toBe(0)
  })

  it('user answering a claimed question gives the agent exactly that decision', async () => {
    // Given a hub whose question was published to a paired device
    const harness = makeHub()
    const pending = harness.hub.approve({ agent: { id: 's-1' }, toolName: 'bash', displayReason: { en: 'run a command', zh: '运行命令' } }, async () => 'unavailable')
    const question = publishedQuestion(harness.transport)
    // When the user allows it once
    await harness.connection.handleText(requestFrame(1, 'approval.resolve', { id: question.id, decision: 'allowed-once' }))
    // Then the agent receives that decision and the phone saw the question in its own language
    expect(question.sessionId).toBe('s-1')
    expect(question.summary).toBe('运行命令')
    expect(await pending).toBe('allowed-once')  })

  it('user rejecting a claimed question gives the agent a refusal', async () => {
    // Given a hub whose question was published to a paired device
    const harness = makeHub()
    const pending = harness.hub.approve({ agent: { id: 's-1' }, toolName: 'bash' }, async () => 'unavailable')
    const question = publishedQuestion(harness.transport)
    // When the user rejects it
    await harness.connection.handleText(requestFrame(2, 'approval.resolve', { id: question.id, decision: 'rejected' }))
    // Then the agent receives the refusal rather than the fail-closed default
    expect(await pending).toBe('rejected')
    expect(question.summary).toBe('bash')
  })

  it('user answering a question twice has the second answer refused as unknown', async () => {
    // Given a question already answered
    const harness = makeHub()
    const pending = harness.hub.approve({ agent: { id: 's-1' }, toolName: 'bash' }, async () => 'unavailable')
    const question = publishedQuestion(harness.transport)
    await harness.connection.handleText(requestFrame(3, 'approval.resolve', { id: question.id, decision: 'allowed-once' }))
    // When the same id is answered again
    await harness.connection.handleText(requestFrame(4, 'approval.resolve', { id: question.id, decision: 'rejected' }))
    // Then the stale answer is refused and the first decision stands
    expect(answerOf(harness, 4).e?.code).toBe('approval-unknown')
    expect(await pending).toBe('allowed-once')
  })

  it('user answering a question nobody asked is refused as unknown', async () => {
    // Given a paired connection
    const harness = makeConnection({ paired: true })
    // When it answers a question id that was never issued
    await harness.connection.handleText(requestFrame(5, 'approval.resolve', { id: 'q-nothing', decision: 'allowed-once' }))
    // Then the refusal is unknown, not a claim on somebody else's question
    expect(answerOf(harness, 5).e?.code).toBe('approval-unknown')
  })

  it('operator loses the last phone and the claimed question is delegated', async () => {
    // Given a claimed question on a hub whose only device is about to go away
    const harness = makeHub()
    const pending = harness.hub.approve({ agent: { id: 's-1' }, toolName: 'bash' }, async () => 'unavailable')
    // When the connection closes
    harness.hub.detach(harness.connection)
    // Then the agent is not left waiting for a phone that is gone
    expect(await pending).toBe('unavailable')
  })

  it('operator runs with no paired device and the question never leaves the host', async () => {
    // Given a hub whose only connection is unpaired
    const harness = makeHub({ paired: false })
    // When the agent asks
    const pending = harness.hub.approve({ agent: { id: 's-1' }, toolName: 'bash' }, async () => 'unavailable')
    // Then nothing was published and the next answerer decides
    expect(harness.transport.ofType('ev')).toEqual([])
    expect(await pending).toBe('unavailable')
    expect(harness.hub.pairedClients).toBe(0)
  })

  it('operator reads the question summary in the operator language before the tool name', () => {
    // Given three questions, one localized in Chinese, one only in English, one not localized at all
    const summaries = [
      approvalSummary({ agent: { id: 's-1' }, toolName: 'bash', displayReason: { en: 'run a command', zh: '运行命令' } }),
      approvalSummary({ agent: { id: 's-1' }, toolName: 'bash', displayReason: { en: 'run a command' } }),
      approvalSummary({ agent: { id: 's-1' }, toolName: 'bash' }),
    ]
    // When the phone's summary line is built
    // Then the Chinese presentation wins, then English, then the tool name
    expect(summaries).toEqual(['运行命令', 'run a command', 'bash'])
  })

  it('operator abandons every pending question when the bridge unloads', async () => {
    // Given two claimed questions
    const harness = makeHub()
    const first = harness.hub.approve({ agent: { id: 's-1' }, toolName: 'bash' }, async () => 'unavailable')
    const second = harness.hub.approve({ agent: { id: 's-2' }, toolName: 'read' }, async () => 'unavailable')
    // When the plugin is torn down
    harness.hub.dispose()
    // Then both are delegated and no timer is left holding the process
    expect(await first).toBe('unavailable')
    expect(await second).toBe('unavailable')
    expect(harness.approvals.size).toBe(0)
  })
})

describe('approval replay', () => {
  afterEach(() => { vi.useRealTimers() })

  it('operator a phone that reconnects is handed the approval it missed', async () => {
    // Given an approval question waiting, which the phone was shown once
    const harness = makeHub()
    const pending = harness.hub.approve(hostApproval(), unavailable)
    const first = approvalPayloads(harness.transport)
    expect(first).toHaveLength(1)
    // When that phone declares the approval capability again after reconnecting
    await declareApprovals(harness.connection, 9)
    // Then it is handed the live question again, byte for byte the card it first took
    const replayed = approvalPayloads(harness.transport).slice(1)
    expect(replayed).toEqual(first)
    // And the question is answerable under that same id, settling exactly once
    await harness.connection.handleText(requestFrame(10, 'approval.resolve', { id: first[0]?.id as string, decision: 'allowed-once' }))
    expect(await pending).toBe('allowed-once')
    expect(harness.approvals.size).toBe(0)
  })

  it('user of a client that declares no approval capability is handed nothing extra', async () => {
    // Given a paired phone that knows only the user-question channel
    const harness = makeHub()
    const pending = harness.hub.approve(hostApproval(), unavailable)
    expect(approvalPayloads(harness.transport)).toHaveLength(1)
    // When it declares a capability that is not this bridge's approval one
    await harness.connection.handleText(requestFrame(9, 'hello', { proto: 1, cap: ['questions.v1'] }))
    // Then the first broadcast stays the only approval frame it ever took
    expect(approvalPayloads(harness.transport)).toHaveLength(1)
    // And the question is still live, so saying "no card" was the declaration and not the question
    expect(harness.approvals.size).toBe(1)
    await harness.connection.handleText(requestFrame(10, 'approval.resolve', { id: publishedQuestion(harness.transport).id, decision: 'rejected' }))
    expect(await pending).toBe('rejected')
  })

  it('user of a phone that declared the capability before the ask is shown the question exactly once', async () => {
    // Given a phone that announced the approval channel at handshake time
    const harness = makeHub()
    await declareApprovals(harness.connection)
    // When a tool asks for permission
    const pending = harness.hub.approve(hostApproval(), unavailable)
    // Then the first broadcast is the only frame it took, with no replay beside it
    expect(approvalPayloads(harness.transport)).toHaveLength(1)
    // And the question is answered by that one card
    await harness.connection.handleText(requestFrame(9, 'approval.resolve', { id: publishedQuestion(harness.transport).id, decision: 'allowed-once' }))
    expect(await pending).toBe('allowed-once')
  })

  it('operator an approval the user already answered is never handed out again', async () => {
    // Given an approval question that was answered
    const harness = makeHub()
    const pending = harness.hub.approve(hostApproval(), unavailable)
    await harness.connection.handleText(requestFrame(1, 'approval.resolve', { id: publishedQuestion(harness.transport).id, decision: 'allowed-once' }))
    expect(await pending).toBe('allowed-once')
    // When the phone declares the channel after reconnecting
    await declareApprovals(harness.connection, 9)
    // Then nothing is replayed: the question was released from the claim registry
    expect(approvalPayloads(harness.transport)).toHaveLength(1)
    expect(harness.approvals.openPrompts()).toEqual([])
  })

  it('operator an approval the bridge timed out is never handed out again, and a replay never extends it', async () => {
    // Given an approval question claimed under the bridge's own timeout
    vi.useFakeTimers()
    const harness = makeHub()
    const pending = harness.hub.approve(hostApproval(), unavailable)
    // When the phone stays reachable and reconnects near the end, and is handed the live question
    await liveFor(harness.connection, 100_000)
    await declareApprovals(harness.connection, 9)
    expect(approvalPayloads(harness.transport)).toHaveLength(2)
    // Then the claim still ends when its own deadline says, not twenty seconds later
    await vi.advanceTimersByTimeAsync(20_000)
    expect(await pending).toBe('unavailable')
    // And a phone that reconnects after that is handed nothing at all
    await declareApprovals(harness.connection, 10)
    expect(approvalPayloads(harness.transport)).toHaveLength(2)
  })

  it('operator an approval withdrawn with the last phone is never handed out again', async () => {
    // Given a claimed question on a hub whose only device is about to go away
    const harness = makeHub()
    const pending = harness.hub.approve(hostApproval(), unavailable)
    expect(approvalPayloads(harness.transport)).toHaveLength(1)
    // When it closes and the question is withdrawn instead of waiting out the timeout
    harness.hub.detach(harness.connection)
    expect(await pending).toBe('unavailable')
    // Then a phone that comes back to that hub is handed no such question
    const returning = new RecordingTransport()
    const fresh = harness.hub.attach(returning, { deviceId: 'dev_returning' })
    await declareApprovals(fresh)
    expect(approvalPayloads(returning)).toEqual([])
  })

  it('operator an unpaired connection that declares the capability is handed no approval', async () => {
    // Given a paired phone holding one question and an unpaired socket beside it
    const bare = makeBareHub()
    const pairedTransport = new RecordingTransport()
    bare.hub.attach(pairedTransport, { deviceId: 'dev_paired' })
    const unpairedTransport = new RecordingTransport()
    const unpaired = bare.hub.attach(unpairedTransport)
    const pending = bare.hub.approve(hostApproval(), unavailable)
    expect(approvalPayloads(pairedTransport)).toHaveLength(1)
    // When the unpaired socket declares the approval capability
    await declareApprovals(unpaired)
    // Then the pairing gate still decides: it is handed nothing
    expect(approvalPayloads(unpairedTransport)).toEqual([])
    expect(bare.approvals.size).toBe(1)
    bare.hub.dispose()
    expect(await pending).toBe('unavailable')
  })

  it('operator the claim registry names only the questions that can still be answered', async () => {
    // Given three claimed questions and three ways to release one
    let minted = 0
    const registry = new ApprovalRegistry({ random: () => `q-${++minted}` })
    const controller = new AbortController()
    registry.open({ sessionId: 's-1', toolName: 'bash', summary: 'one' })
    registry.open({ sessionId: 's-2', toolName: 'read', summary: 'two', signal: controller.signal })
    registry.open({ sessionId: 's-3', toolName: 'write', summary: 'three' })
    // Then all three are offered for a replay while they are unanswered
    expect(registry.openPrompts().map(prompt => prompt.id)).toEqual(['q-1', 'q-2', 'q-3'])
    expect(registry.openPrompts()[0]).toEqual({ id: 'q-1', sessionId: 's-1', toolName: 'bash', summary: 'one' })
    // When one is answered, one loses its asker and one is withdrawn by the bridge
    registry.resolve('q-1', 'rejected')
    controller.abort()
    registry.abandon(['q-3'])
    // Then no release path leaves a question in the set a replay would read
    expect(registry.openPrompts()).toEqual([])
    expect(registry.size).toBe(0)
  })
})

/**
 * The host's own answerer as the panel shows it: a card that answers on a click.
 *
 * The claim offers the panel the same question the moment it is created, so every
 * case below has two answerers. `calls` is how many times the panel was offered
 * the question and `answer` is the click that settles it.
 */
interface PanelCard {
  readonly next: () => Promise<'allowed-once' | 'rejected'>
  readonly calls: () => number
  readonly answer: (outcome: 'allowed-once' | 'rejected') => void
}

/** Build one {@link PanelCard}: a chain that answers only when the suite clicks. */
function panelCard(): PanelCard {
  let clicks = 0
  let settle: (outcome: 'allowed-once' | 'rejected') => void = () => undefined
  const pending = new Promise<'allowed-once' | 'rejected'>(resolve => { settle = resolve })
  return {
    next: () => {
      clicks += 1
      return pending
    },
    calls: () => clicks,
    answer: (outcome) => { settle(outcome) },
  }
}

describe('approval: the panel and the phone share one question', () => {
  afterEach(() => { vi.useRealTimers() })

  it('user the panel decides first and the phone is told the card is over', async () => {
    // Given a paired phone and the host's own panel holding the same question
    const harness = makeHub()
    const desktop = panelCard()
    const pending = harness.hub.approve(hostApproval(), desktop.next)
    const open = approvalPayloads(harness.transport)
    // Then one card went out, with no state field: absent means still open
    expect(open).toHaveLength(1)
    expect(open[0]).not.toHaveProperty('state')
    expect(desktop.calls()).toBe(1)
    // When the panel allows it once
    desktop.answer('allowed-once')
    // Then that decision is the one the agent receives
    expect(await pending).toBe('allowed-once')
    // And the phone's card is over, with the one field that says so
    const frames = approvalPayloads(harness.transport)
    expect(frames).toHaveLength(2)
    expect(frames[1]).toEqual({ ...open[0], state: 'settled' })
    // And the claim is released: the id is refused and no replay hands it out again
    expect(harness.approvals.openPrompts()).toEqual([])
    await harness.connection.handleText(requestFrame(2, 'approval.resolve', { id: open[0]?.id as string, decision: 'rejected' }))
    expect(answerOf(harness, 2).e?.code).toBe('approval-unknown')
  })

  it('operator the fail-closed default the chain returns is not a decision', async () => {
    // Given a phone holding an approval and a host whose own answerers fall through
    const harness = makeHub()
    const pending = harness.hub.approve(hostApproval(), async () => 'unavailable')
    await settle()
    // Then nothing was announced as over and the phone's card is still answerable
    expect(approvalPayloads(harness.transport)).toHaveLength(1)
    expect(harness.approvals.size).toBe(1)
    // When the phone answers it, that decision is the one the agent receives
    await harness.connection.handleText(requestFrame(3, 'approval.resolve', { id: publishedQuestion(harness.transport).id, decision: 'allowed-once' }))
    expect(await pending).toBe('allowed-once')
  })

  it('operator a chain that throws is not a decision either', async () => {
    // Given a phone holding an approval and a host whose own answerers throw
    const harness = makeHub()
    const pending = harness.hub.approve(hostApproval(), async () => { throw new Error('no approval answerer accepted the request') })
    await settle()
    // Then nothing was announced as over and the phone still decides
    expect(approvalPayloads(harness.transport)).toHaveLength(1)
    // When the phone rejects it, that decision is the one the agent receives
    await harness.connection.handleText(requestFrame(5, 'approval.resolve', { id: publishedQuestion(harness.transport).id, decision: 'rejected' }))
    expect(await pending).toBe('rejected')
  })

  it('user the phone answers first and the panel answer landing afterwards is ignored', async () => {
    // Given both surfaces holding the same question
    const harness = makeHub()
    const desktop = panelCard()
    const pending = harness.hub.approve(hostApproval(), desktop.next)
    const open = approvalPayloads(harness.transport)
    expect(desktop.calls()).toBe(1)
    // When the phone rejects it first
    await harness.connection.handleText(requestFrame(4, 'approval.resolve', { id: open[0]?.id as string, decision: 'rejected' }))
    expect(await pending).toBe('rejected')
    // And the panel's click lands afterwards
    const before = approvalPayloads(harness.transport).length
    desktop.answer('allowed-once')
    await settle()
    // Then no second decision was taken and nothing was announced a second time
    expect(await pending).toBe('rejected')
    expect(approvalPayloads(harness.transport)).toHaveLength(before)
    expect(harness.approvals.size).toBe(0)
  })
})
