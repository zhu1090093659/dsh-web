/**
 * Settlement write-back: what one finished execution tells the hub.
 *
 * The events come through the board's own registry fanout, so the subscription
 * the extension really installed is what these specs drive; the mapping asserted
 * is team-hub/PROTOCOL.md section 5 (a succeeded execution verdict becomes
 * \`succeeded\` and moves the issue to \`in_review\`, everything else becomes
 * \`failed\`) plus the section 13 summary cap.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEAM_EXTENSION_ID, readTaskIssueLink } from '../src/core/identity.ts'
import { EXECUTION_SUMMARY_LIMIT } from '../src/core/hub-protocol.ts'
import { flush, makeHarness, type Harness } from './support/harness.ts'

let harness: Harness | undefined

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  harness?.release()
  harness = undefined
  vi.useRealTimers()
})

/** Claim and start one issue, then return the card and its open execution id. */
async function claimedCard(current: Harness): Promise<{ taskId: string; executionId: string }> {
  current.hub.addIssue({ assigneeAgentId: 'agent_1' })
  await current.service().sweep()
  await flush()
  const task = current.tasks()[0]
  const execution = task.executions[task.executions.length - 1]
  return { taskId: task.id, executionId: execution.id }
}

describe('settlement write-back', () => {
  it('operator sees a passed execution settle the issue into review', async () => {
    // Given a claimed issue whose execution finished with a pass
    harness = makeHarness()
    const { taskId, executionId } = await claimedCard(harness)

    // When the board reports the settlement
    harness.board.extensions.emitExecutionSettled({ taskId, executionId, outcome: 'succeeded' })
    await flush()

    // Then the hub was told succeeded, under the attempt the card was claimed
    // with, and moved the issue to in_review
    const settle = harness.hub.calls.filter(call => call.path.endsWith('/settle'))
    expect(settle).toHaveLength(1)
    expect((settle[0].body as { outcome: string }).outcome).toBe('succeeded')
    expect((settle[0].body as { execution_attempt_id: string }).execution_attempt_id).toBe('attempt_1')
    expect(harness.hub.issues.get('issue_1')?.status).toBe('in_review')
    expect(readTaskIssueLink(harness.tasks()[0])?.hubStatus).toBe('in_review')
  })

  it('operator sees a failed execution settle the issue as failed with its reason', async () => {
    // Given a claimed issue whose execution failed
    harness = makeHarness()
    const { taskId, executionId } = await claimedCard(harness)

    // When the board reports the failure
    harness.board.extensions.emitExecutionSettled({
      taskId,
      executionId,
      outcome: 'failed',
      error: 'the acceptance command exited 1',
    })
    await flush()

    // Then the hub stored a failed settlement carrying that reason
    const settle = harness.hub.calls.filter(call => call.path.endsWith('/settle'))
    expect((settle[0].body as { outcome: string }).outcome).toBe('failed')
    expect((settle[0].body as { error: string }).error).toBe('the acceptance command exited 1')
    expect(harness.hub.issues.get('issue_1')?.status).toBe('failed')
  })

  it('operator sees a cancelled execution reported as failed rather than as a pass', async () => {
    // Given a claimed issue whose execution was cancelled
    harness = makeHarness()
    const { taskId, executionId } = await claimedCard(harness)

    // When the board reports the cancellation
    harness.board.extensions.emitExecutionSettled({ taskId, executionId, outcome: 'cancelled' })
    await flush()

    // Then the hub was told failed, because a stopped run never earned a review
    const settle = harness.hub.calls.filter(call => call.path.endsWith('/settle'))
    expect((settle[0].body as { outcome: string }).outcome).toBe('failed')
  })

  it('operator sees an oversized summary clipped to the protocol cap', async () => {
    // Given a claimed issue whose failure text is far past the cap
    harness = makeHarness()
    const { taskId, executionId } = await claimedCard(harness)

    // When the settlement carries a very long reason
    harness.board.extensions.emitExecutionSettled({
      taskId,
      executionId,
      outcome: 'failed',
      error: 'x'.repeat(EXECUTION_SUMMARY_LIMIT * 2),
    })
    await flush()

    // Then both the summary and the error respect the cap
    const body = harness.hub.calls.filter(call => call.path.endsWith('/settle'))[0].body as { summary: string; error: string }
    expect(body.summary.length).toBe(EXECUTION_SUMMARY_LIMIT)
    expect(body.error.length).toBe(EXECUTION_SUMMARY_LIMIT)
  })

  it('operator sees a settled card release the attempt and lease it no longer holds', async () => {
    // Given a claimed card that carries its attempt and lease
    harness = makeHarness()
    const { taskId, executionId } = await claimedCard(harness)
    expect(readTaskIssueLink(harness.tasks()[0])?.attemptId).toBe('attempt_1')
    expect(readTaskIssueLink(harness.tasks()[0])?.leaseToken).toBe('lease_1')

    // When the settlement is accepted
    harness.board.extensions.emitExecutionSettled({ taskId, executionId, outcome: 'succeeded' })
    await flush()

    // Then the card carries neither of them: settling is the last thing this
    // Host does with an attempt, so a later claim of the issue is fresh
    const link = readTaskIssueLink(harness.tasks()[0])
    expect(link?.attemptId).toBeUndefined()
    expect(link?.leaseToken).toBeUndefined()
    expect(link?.pendingSettle).toBeUndefined()
    expect(link?.hubStatus).toBe('in_review')
  })

  it('operator sees a settlement a hub outage refused kept and cleared by the next sweep retry', async () => {
    // Given a claimed card whose settlement a hub outage refused
    harness = makeHarness()
    const { taskId, executionId } = await claimedCard(harness)
    harness.hub.settleFailures.push({ status: 503, code: 'HUB_UNAVAILABLE' })

    // When the board reports the settlement
    harness.board.extensions.emitExecutionSettled({ taskId, executionId, outcome: 'succeeded' })
    await flush()

    // Then the outcome the run produced is kept on the card, under the attempt
    // it belongs to, and the hub still holds the issue
    const pending = readTaskIssueLink(harness.tasks()[0])?.pendingSettle
    expect(pending).toMatchObject({ outcome: 'succeeded', execution_attempt_id: 'attempt_1' })
    expect(String(pending?.summary)).toContain('#1 Ship the thing')
    expect(harness.hub.issues.get('issue_1')?.status).toBe('running')

    // When the next sweep runs and the hub takes the same body
    await harness.service().sweep()
    await flush()

    // Then the hub moved the issue and the card carries no pending write-back
    expect(harness.hub.issues.get('issue_1')?.status).toBe('in_review')
    expect(readTaskIssueLink(harness.tasks()[0])?.pendingSettle).toBeUndefined()
  })

  it('operator sees an expired settlement dropped with a visible refusal instead of retried', async () => {
    // Given a claimed issue whose attempt the hub no longer holds
    harness = makeHarness()
    const { taskId, executionId } = await claimedCard(harness)
    const issue = harness.hub.issues.get('issue_1')
    if (issue === undefined) throw new Error('the fake hub lost the issue')
    issue.leaseToken = undefined
    issue.attemptId = 'attempt_from_another_host'

    // When the settlement for the old attempt is refused as expired
    harness.board.extensions.emitExecutionSettled({ taskId, executionId, outcome: 'succeeded' })
    await flush()

    // Then the refusal is visible and the write-back is dropped together with the
    // credentials of the attempt it can never be reported under
    const link = readTaskIssueLink(harness.tasks()[0])
    expect(String(harness.service().summary().cards[taskId]?.lastError)).toContain('LEASE_EXPIRED')
    expect(String(link?.lastError)).toContain('dropped instead of retried')
    expect(link?.pendingSettle).toBeUndefined()
    expect(link?.attemptId).toBeUndefined()
    expect(link?.leaseToken).toBeUndefined()

    // When the next sweep runs, nothing is retried because nothing could land
    const settles = harness.hub.calls.filter(call => call.path.endsWith('/settle')).length
    await harness.service().sweep()
    await flush()
    expect(harness.hub.calls.filter(call => call.path.endsWith('/settle'))).toHaveLength(settles)
    expect(harness.hub.issues.get('issue_1')?.status).not.toBe('in_review')
  })

  it('operator sees a settlement the hub forbids dropped instead of retried', async () => {
    // Given a claimed card whose write-back the hub refuses outright
    harness = makeHarness()
    const { taskId, executionId } = await claimedCard(harness)
    harness.hub.settleFailures.push({ status: 403, code: 'FORBIDDEN' })

    // When the settlement is refused
    harness.board.extensions.emitExecutionSettled({ taskId, executionId, outcome: 'succeeded' })
    await flush()

    // Then the refusal is visible and the write-back is gone, because the same
    // request would be refused again
    const link = readTaskIssueLink(harness.tasks()[0])
    expect(String(harness.service().summary().cards[taskId]?.lastError)).toContain('FORBIDDEN')
    expect(String(link?.lastError)).toContain('dropped instead of retried')
    expect(link?.pendingSettle).toBeUndefined()
    expect(link?.attemptId).toBeUndefined()

    // When the next sweep runs, the hub is not asked a second time
    const settles = harness.hub.calls.filter(call => call.path.endsWith('/settle')).length
    await harness.service().sweep()
    await flush()
    expect(harness.hub.calls.filter(call => call.path.endsWith('/settle'))).toHaveLength(settles)
  })

  it('operator sees a settlement refused for an unknown Host Token kept for the corrected token', async () => {
    // Given a claimed card whose write-back meets a token the hub does not recognize
    harness = makeHarness()
    const { taskId, executionId } = await claimedCard(harness)
    harness.hub.settleFailures.push({ status: 401, code: 'UNAUTHORIZED' })

    // When the settlement is refused
    harness.board.extensions.emitExecutionSettled({ taskId, executionId, outcome: 'succeeded' })
    await flush()

    // Then the outcome stays owed with its attempt, because a corrected token can still deliver it
    const link = readTaskIssueLink(harness.tasks()[0])
    expect(link?.pendingSettle?.execution_attempt_id).toBe('attempt_1')
    expect(link?.attemptId).toBe('attempt_1')

    // When the next sweep runs with the hub accepting again
    await harness.service().sweep()
    await flush()

    // Then the same outcome lands and the debt is cleared
    expect(harness.hub.issues.get('issue_1')?.status).toBe('in_review')
    expect(readTaskIssueLink(harness.tasks()[0])?.pendingSettle).toBeUndefined()
  })

  it('operator sees a settlement lost to the network kept and retried by the next sweep', async () => {
    // Given a claimed card whose settlement never reached the hub
    harness = makeHarness()
    const { taskId, executionId } = await claimedCard(harness)
    harness.hub.settleFailures.push('network')

    // When the board reports the settlement
    harness.board.extensions.emitExecutionSettled({ taskId, executionId, outcome: 'succeeded' })
    await flush()

    // Then the outcome stays on the card under the attempt that produced it, and
    // nothing was dropped: a transport failure says nothing about the attempt
    const owed = readTaskIssueLink(harness.tasks()[0])
    expect(owed?.pendingSettle).toMatchObject({ outcome: 'succeeded', execution_attempt_id: 'attempt_1' })
    expect(owed?.attemptId).toBe('attempt_1')
    expect(harness.hub.issues.get('issue_1')?.status).toBe('running')

    // When the next sweep reaches a hub that answers again
    await harness.service().sweep()
    await flush()

    // Then the write-back landed, and the card carries neither the pending record
    // nor the attempt of the run it reported
    expect(harness.hub.issues.get('issue_1')?.status).toBe('in_review')
    const link = readTaskIssueLink(harness.tasks()[0])
    expect(link?.pendingSettle).toBeUndefined()
    expect(link?.attemptId).toBeUndefined()
  })

  it('operator sees a settlement the hub could not take retried before the issue is claimed', async () => {
    // Given a claimed card whose write-back two outages in a row refused
    harness = makeHarness()
    const { taskId, executionId } = await claimedCard(harness)
    harness.hub.settleFailures.push({ status: 503, code: 'HUB_UNAVAILABLE' })
    harness.board.extensions.emitExecutionSettled({ taskId, executionId, outcome: 'succeeded' })
    await flush()
    const issue = harness.hub.issues.get('issue_1')
    if (issue === undefined) throw new Error('the fake hub lost the issue')
    expect(readTaskIssueLink(harness.tasks()[0])?.pendingSettle).toMatchObject({ outcome: 'succeeded' })

    // And its lease lapsed while the write-back was still owed
    issue.leaseToken = undefined
    issue.status = 'waiting_host'
    const claims = harness.hub.calls.filter(call => call.path.endsWith('/claim')).length
    const renewals = harness.hub.calls.filter(call => call.path.endsWith('/renew-lease')).length

    // When the next sweep meets another refusal
    harness.hub.settleFailures.push({ status: 503, code: 'HUB_UNAVAILABLE' })
    await harness.service().sweep()
    await flush()

    // Then no attempt was taken for the card and nothing renewed a lease for it:
    // a claim here would mint an attempt this Host never runs, and the retry of
    // the owed body would then die against it
    expect(harness.hub.calls.filter(call => call.path.endsWith('/claim'))).toHaveLength(claims)
    expect(harness.hub.calls.filter(call => call.path.endsWith('/renew-lease'))).toHaveLength(renewals)
    expect(harness.hub.issues.get('issue_1')?.status).toBe('waiting_host')
    expect(readTaskIssueLink(harness.tasks()[0])?.pendingSettle).toMatchObject({
      outcome: 'succeeded',
      execution_attempt_id: 'attempt_1',
    })

    // When a later sweep finds the hub ready, the result lands and the card
    // carries nothing of the finished run any more
    await harness.service().sweep()
    await flush()
    expect(harness.hub.issues.get('issue_1')?.status).toBe('in_review')
    const link = readTaskIssueLink(harness.tasks()[0])
    expect(link?.pendingSettle).toBeUndefined()
    expect(link?.attemptId).toBeUndefined()
  })

  it('operator sees a settlement of a replaced attempt dropped without touching the one that replaced it', async () => {
    // Given a run whose settlement the hub stored but whose answer never arrived,
    // so the card still owes it
    harness = makeHarness()
    const { taskId, executionId } = await claimedCard(harness)
    harness.hub.settleFailures.push('lose-response')
    harness.ledger.settle(taskId, executionId, 'succeeded')
    harness.board.extensions.emitExecutionSettled({ taskId, executionId, outcome: 'succeeded' })
    await flush()
    expect(harness.hub.issues.get('issue_1')?.status).toBe('in_review')
    expect(readTaskIssueLink(harness.tasks()[0])?.pendingSettle).toMatchObject({ execution_attempt_id: 'attempt_1' })
    const stale = readTaskIssueLink(harness.tasks()[0])?.pendingSettle

    // When the reviewer rejects and the rework claims a fresh attempt whose own
    // write-back a transport failure keeps on the card
    const issue = harness.hub.issues.get('issue_1')
    if (issue === undefined) throw new Error('the fake hub lost the issue')
    issue.status = 'assigned'
    issue.reworkInstructions = 'add the missing test'
    harness.hub.settleFailures.push('network')
    harness.hub.push('issue.rework', { issue_id: 'issue_1', instructions: 'add the missing test', reviewer_member_id: 'mem_reviewer' })
    await flush()

    // Then the claim dropped the round it replaced, and the card runs under the
    // attempt the hub minted for the rework
    const reworked = readTaskIssueLink(harness.tasks()[0])
    expect(reworked?.attemptId).toBe('attempt_2')
    expect(reworked?.leaseToken).toBe('lease_2')
    expect(reworked?.pendingSettle).toMatchObject({ execution_attempt_id: 'attempt_2' })

    // When a retry of the replaced round is still on its way out and meets the hub
    const errorsBefore = readTaskIssueLink(harness.tasks()[0])?.lastError
    const payload = harness.tasks()[0].integrations?.[TEAM_EXTENSION_ID] as Record<string, unknown>
    harness.face().integration.write(taskId, { ...payload, pendingSettle: stale })
    await harness.service().sweep()
    await flush()

    // Then the hub refused it as an attempt it no longer holds, the card kept the
    // attempt and lease the rework runs under, and no error was invented for a
    // round the newer run already replaced
    const after = readTaskIssueLink(harness.tasks()[0])
    expect(after?.attemptId).toBe('attempt_2')
    expect(after?.leaseToken).toBe('lease_2')
    expect(after?.pendingSettle).toBeUndefined()
    // The card's error is still the one the rework's own lost write-back left;
    // the refusal of the replaced round added nothing to it
    expect(after?.lastError).toBe(errorsBefore)
    expect(harness.service().summary().cards[taskId]?.lastError).toBe(errorsBefore)
  })

  it('operator sees a card that mirrors no issue write nothing back', async () => {
    // Given a plain board card created outside this provider
    harness = makeHarness()
    harness.board.apply('plain-card', {
      kind: 'create',
      id: 'plain',
      input: { title: 'Plain', description: '', prompt: 'do it' },
    })

    // When an execution of it settles
    harness.board.extensions.emitExecutionSettled({ taskId: 'plain', executionId: 'exec-x', outcome: 'succeeded' })
    await flush()

    // Then this provider stayed out of it
    expect(harness.hub.calls.filter(call => call.path.endsWith('/settle'))).toHaveLength(0)
    expect(harness.tasks()[0].integrations?.[TEAM_EXTENSION_ID]).toBeUndefined()
  })
})