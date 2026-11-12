/**
 * The spawn-to-call correlation behind a subagent thread: which tool call a
 * `subagent/catalog` entry belongs to, decided from the spawn's own result in
 * the two shapes this harness writes, with the per-step single call kept as the
 * fallback, and the same rule answering a baseline and a live subscription.
 * @module tests/subagent-spawn
 */

import { describe, expect, it } from 'vitest'
import { CAP_SESSION_SNAPSHOT_SINCE, CAP_SESSION_SNAPSHOT_TRIM, CAP_SUBAGENT_THREAD } from '../src/core/protocol.ts'
import { ControllableStream, answerOf, makeConnection, requestFrame, settle, type ConnectionHarness, type WireFrame } from './support/harness.ts'

/** One follow record as DSH writes it. */
function record(type: string, seq: number, data: unknown): unknown {
  return { type: 'event', event: { type, seq, time: 100 + seq, data } }
}

/** One follow opening frame. */
function baseline(records: unknown[], cursor: number): unknown {
  return { type: 'snapshot', header: {}, cursor, hasMore: false, projections: {}, records }
}

/** One durable `tool/call`. */
function toolCall(seq: number, callId: string, name = 'subagent', step = 1): unknown {
  return record('tool/call', seq, { turn: 1, step, callId, name, arguments: '{}' })
}

/** One durable `tool/result` whose text is the tool's own output. */
function toolResult(seq: number, callId: string, text: string, step = 1): unknown {
  return record('tool/result', seq, {
    turn: 1,
    step,
    message: { role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId, content: [{ type: 'text', text }], isError: false },
  })
}

/** One durable `subagent/catalog`, with the payload a real host writes. */
function catalog(seq: number, childId: string): unknown {
  return record('subagent/catalog', seq, { version: 0, childId, childCreatedAt: 1792368065776, mode: 'continuable', label: 'Thread probe' })
}

/** The activation handle a PTC `run_code` program returns for a spent `subagent` call. */
function activationHandle(...childIds: readonly string[]): string {
  const handles: Record<string, unknown> = {}
  for (const [index, childId] of childIds.entries()) handles[`slot${index}`] = { kind: 'activation', subagentId: childId }
  return JSON.stringify(handles)
}

/** One snapshot entry as it crossed the wire. */
interface WireEntry {
  readonly seq: number
  readonly type: string
  readonly data: Record<string, unknown>
}

/** Open one session whose baseline is the given records, declaring the trim and thread channels. */
async function snapshotOf(records: unknown[], cap: readonly string[] = [CAP_SESSION_SNAPSHOT_TRIM, CAP_SUBAGENT_THREAD]): Promise<WireEntry[]> {
  const harness = makeConnection({ paired: true })
  await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: [...cap] }))
  const follow = new ControllableStream()
  harness.gateway.follow = call => follow.attach(call.signal).iterable()
  const pending = harness.connection.handleText(requestFrame(2, 'session.snapshot', { sessionId: 's-1' }))
  follow.push(baseline(records, records.length))
  await pending
  const answer = answerOf(harness, 2).r as { turns: { entries: WireEntry[] }[] }
  return answer.turns.flatMap(turn => turn.entries)
}

/** Open one live session, then push the same records through its stream. */
async function liveOf(records: unknown[]): Promise<{ harness: ConnectionHarness; stream: ControllableStream }> {
  const harness = makeConnection({ paired: true })
  await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: [CAP_SUBAGENT_THREAD] }))
  const stream = new ControllableStream()
  harness.gateway.follow = () => stream.attach(undefined).iterable()
  const pending = harness.connection.handleText(requestFrame(2, 'session.snapshot', { sessionId: 's-1' }))
  stream.push(baseline([], 0))
  await pending
  for (const item of records) {
    stream.push(item)
    await settle()
  }
  return { harness, stream }
}

/** Every `subagent` delta the live connection published, in arrival order. */
function subagentDeltas(harness: ConnectionHarness): Record<string, unknown>[] {
  return harness.transport
    .frames()
    .filter((frame: WireFrame) => frame.t === 'ev' && frame.m === 'session.delta')
    .map(frame => frame.p as Record<string, unknown>)
    .filter(payload => payload.kind === 'subagent')
}

/** The catalog entry of one snapshot answer. */
function catalogEntryOf(entries: readonly WireEntry[], childId: string): WireEntry | undefined {
  return entries.find(entry => entry.type === 'subagent/catalog' && entry.data.childId === childId)
}

describe('spawn call correlation', () => {
  it('operator opening a session sees the spawn call its result named, even with several calls in the step', async () => {
    // Given a step that issued two calls, whose second result carries the activation handle
    const entries = await snapshotOf([
      record('turn/start', 1, { turn: 1 }),
      record('step/start', 2, { turn: 1, step: 1 }),
      toolCall(3, 'call-read', 'read'),
      toolCall(4, 'call-run', 'run_code'),
      catalog(5, 'child-9'),
      toolResult(6, 'call-run', activationHandle('child-9')),
    ])
    // When the phone reads the catalog entry its baseline carries
    const entry = catalogEntryOf(entries, 'child-9')
    // Then the call the result named won the decision, not the ambiguous step
    expect(entry?.data.callId).toBe('call-run')
  })

  it('operator opening a session sees the call the plain spawn notice named', async () => {
    // Given a host that spawned without PTC, so the result is the tool's own sentence
    const entries = await snapshotOf([
      record('turn/start', 1, { turn: 1 }),
      toolCall(2, 'call-a', 'read'),
      toolCall(3, 'call-b', 'subagent'),
      catalog(4, 'child-7'),
      toolResult(5, 'call-b', 'started subagent child-7'),
    ])
    // When the phone reads the catalog entry
    const entry = catalogEntryOf(entries, 'child-7')
    // Then the notice's own child id decided the call, exactly as the activation handle did
    expect(entry?.data.callId).toBe('call-b')
  })

  it('operator opening a session whose spawn result named no child falls back to the single call of the step', async () => {
    // Given a step with exactly one call and a catalog the host wrote before the result
    const entries = await snapshotOf([
      record('turn/start', 1, { turn: 1 }),
      toolCall(2, 'call-spawn'),
      catalog(3, 'child-9'),
      toolResult(4, 'call-spawn', 'spawned without a handle'),
    ])
    // When the phone reads the catalog entry
    const entry = catalogEntryOf(entries, 'child-9')
    // Then the pre-existing rule still applies: one call in the step is the spawning call
    expect(entry?.data.callId).toBe('call-spawn')
  })

  it('operator opening a session whose spawn result named no child and whose step issued two calls sees no call id', async () => {
    // Given two calls in the step and a result that names no child at all
    const entries = await snapshotOf([
      record('turn/start', 1, { turn: 1 }),
      toolCall(2, 'call-a', 'read'),
      toolCall(3, 'call-b', 'run_code'),
      catalog(4, 'child-9'),
      toolResult(5, 'call-b', 'nothing to correlate here'),
    ])
    // When the phone reads the catalog entry
    const entry = catalogEntryOf(entries, 'child-9')
    // Then the entry is passed through untouched: the wire carries no guessed id
    expect(entry?.data).not.toHaveProperty('callId')
  })

  it('operator opening a session sees no call id lent by a result that merely lists the child', async () => {
    // Given a `list_agents` answer that names the child without the spawn signature
    const entries = await snapshotOf([
      record('turn/start', 1, { turn: 1 }),
      toolCall(2, 'call-list', 'list_agents'),
      toolCall(3, 'call-other', 'read'),
      catalog(4, 'child-9'),
      toolResult(5, 'call-list', '[{"kind":"child","id":"child-9","label":"Thread probe","status":"running"}]'),
    ])
    // When the phone reads the catalog entry
    const entry = catalogEntryOf(entries, 'child-9')
    // Then no call id was invented: a roster of children is not a spawn handle
    expect(entry?.data).not.toHaveProperty('callId')
  })

  it('operator watching a spawn live sees the same call id the baseline would carry', async () => {
    // Given a step whose spawn result precedes the catalog in the stream
    const records = [
      record('turn/start', 1, { turn: 1 }),
      record('step/start', 2, { turn: 1, step: 1 }),
      toolCall(3, 'call-read', 'read'),
      toolCall(4, 'call-run', 'run_code'),
      toolResult(5, 'call-run', activationHandle('child-9')),
      catalog(6, 'child-9'),
    ]
    // When the same records are read as a baseline and watched live
    const entry = (await snapshotOf(records)).find(item => item.type === 'subagent/catalog')
    const live = await liveOf(records)
    const delta = subagentDeltas(live.harness).find(payload => payload.childId === 'child-9')
    // Then both halves of the thread name the same call, because one rule decided it
    expect(entry?.data.callId).toBe('call-run')
    expect(delta?.callId).toBe('call-run')
  })

  it('operator watching a spawn live keeps the step fallback while its result has not been projected yet', async () => {
    // Given a step with one call, whose catalog the host projected first
    const records = [
      record('turn/start', 1, { turn: 1 }),
      toolCall(2, 'call-spawn'),
      catalog(3, 'child-9'),
    ]
    // When the phone is watching the session live
    const live = await liveOf(records)
    const delta = subagentDeltas(live.harness).find(payload => payload.childId === 'child-9')
    // Then today's rule still answers: the single call of the step is the spawn's
    expect(delta?.callId).toBe('call-spawn')
  })
})

describe('the catalog entry in a trimmed baseline', () => {
  it('operator who declared trim receives the catalog entry with the host payload and the spawn call beside it', async () => {
    // Given a session that spawned a child, opened by a client that declared trim
    const entries = await snapshotOf([
      record('turn/start', 1, { turn: 1 }),
      toolCall(2, 'call-run', 'run_code'),
      catalog(3, 'child-9'),
      toolResult(4, 'call-run', activationHandle('child-9')),
    ])
    // When the phone reads the baseline
    const entry = catalogEntryOf(entries, 'child-9')
    // Then the entry survived the trim, still at the sequence the host wrote for it
    expect(entry?.seq).toBe(3)
    expect(entry?.data).toEqual({
      version: 0,
      childId: 'child-9',
      childCreatedAt: 1792368065776,
      mode: 'continuable',
      label: 'Thread probe',
      callId: 'call-run',
    })
  })

  it('operator reconnecting with a watermark receives only what it missed, still carrying the spawn call', async () => {
    // Given a session whose spawn result and catalog both sit above the watermark
    const harness = makeConnection({ paired: true })
    await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: [CAP_SESSION_SNAPSHOT_TRIM, CAP_SUBAGENT_THREAD, CAP_SESSION_SNAPSHOT_SINCE] }))
    const follow = new ControllableStream()
    harness.gateway.follow = call => follow.attach(call.signal).iterable()
    const records = [
      record('turn/start', 1, { turn: 1 }),
      toolCall(2, 'call-run', 'run_code'),
      catalog(3, 'child-9'),
      toolResult(4, 'call-run', activationHandle('child-9')),
    ]
    // When the reconnecting phone names the watermark it already holds
    const pending = harness.connection.handleText(requestFrame(2, 'session.snapshot', { sessionId: 's-1', sinceSeq: 1 }))
    follow.push({ type: 'snapshot', header: {}, cursor: 4, hasMore: false, projections: {}, records })
    await pending
    // Then the answer is the increment, and the catalog it carries still names the spawn call
    const answer = answerOf(harness, 2).r as { mode: string; turns: { entries: WireEntry[] }[] }
    expect(answer.mode).toBe('since')
    const entry = catalogEntryOf(answer.turns.flatMap(turn => turn.entries), 'child-9')
    expect(entry?.data.callId).toBe('call-run')
    expect(entry?.data).toMatchObject({ version: 0, childId: 'child-9', mode: 'continuable', label: 'Thread probe' })
  })

  it('operator on a client without trim receives the same catalog entry including the spawn call', async () => {
    // Given the same session opened by a client that declared no trim
    const entries = await snapshotOf([
      record('turn/start', 1, { turn: 1 }),
      toolCall(2, 'call-run', 'run_code'),
      catalog(3, 'child-9'),
      toolResult(4, 'call-run', activationHandle('child-9')),
    ], [CAP_SUBAGENT_THREAD])
    // When the phone reads the baseline
    const entry = catalogEntryOf(entries, 'child-9')
    // Then both halves of the trim decision report one identical payload
    expect(entry?.data).toEqual({
      version: 0,
      childId: 'child-9',
      childCreatedAt: 1792368065776,
      mode: 'continuable',
      label: 'Thread probe',
      callId: 'call-run',
    })
  })
})
