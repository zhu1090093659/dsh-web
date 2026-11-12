/**
 * Claiming: who this Host takes work for, what the mirror card carries, and how a
 * reconnect avoids running the same attempt twice.
 *
 * Everything runs over the real board and the specification-conforming fake hub,
 * so the claim/lease/reconnect rules of team-hub/PROTOCOL.md section 5 are what
 * is being asserted, not a stand-in's behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEAM_EXTENSION_ID, readTaskIssueLink } from '../src/core/identity.ts'
import { FIXTURE_WORKSPACE, boundAgent, flush, makeHarness, type Harness } from './support/harness.ts'

let harness: Harness | undefined

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  harness?.release()
  harness = undefined
  vi.useRealTimers()
})

describe('claiming team issues', () => {
  it('operator sees only the issues of agents bound to this machine claimed', async () => {
    // Given a hub offering one issue for a bound agent and one for another machine
    harness = makeHarness()
    harness.hub.addIssue({ assigneeAgentId: 'agent_1', title: 'Ship the thing' })
    harness.hub.addIssue({ id: 'issue_other', assigneeAgentId: 'agent_elsewhere', title: 'Other machine work' })

    // When the provider registers and sweeps
    await harness.service().sweep()

    // Then only the bound agent's issue became a card, and the other one did not
    const tasks = harness.tasks()
    expect(tasks.map(task => task.title)).toEqual(['#1 Ship the thing'])
    expect(readTaskIssueLink(tasks[0])?.issueId).toBe('issue_1')
  })

  it('operator gets a mirror card carrying the issue, attempt and lease identities', async () => {
    // Given a hub with one claimable issue
    harness = makeHarness()
    harness.hub.addIssue({ assigneeAgentId: 'agent_1', title: 'Ship the thing', description: 'Body text.' })

    // When the provider sweeps
    await harness.service().sweep()

    // Then the card's payload carries the identities a reconnect needs
    const payload = harness.tasks()[0].integrations?.[TEAM_EXTENSION_ID] as Record<string, unknown>
    expect(payload).toMatchObject({
      issueId: 'issue_1',
      issueNumber: 1,
      attemptId: 'attempt_1',
      leaseToken: 'lease_1',
      agentMemberId: 'mem_builder',
      preset: 'liangshen',
    })
    // And the registered Host speaks the frozen protocol version with its token
    const register = harness.hub.calls.find(call => call.path.endsWith('/hosts/register'))
    expect(register?.protocolVersion).toBe('1.0.0')
    expect(register?.authorization).toBe('Bearer th_host_token')
  })

  it('operator sees the claimed card started once the board accepts the run', async () => {
    // Given a hub with one claimable issue
    harness = makeHarness()
    harness.hub.addIssue({ assigneeAgentId: 'agent_1' })

    // When the provider claims it
    await harness.service().sweep()
    await flush()

    // Then the board really opened an execution session for that card
    expect(harness.creates).toHaveLength(1)
    expect(harness.tasks()[0].status).toBe('running')
  })

  it('operator sees the lease renewed every twenty seconds while the execution runs', async () => {
    // Given a claimed issue whose card is executing
    harness = makeHarness()
    harness.hub.addIssue({ assigneeAgentId: 'agent_1' })
    await harness.service().sweep()
    await flush()
    const before = harness.hub.calls.filter(call => call.path.endsWith('/renew-lease')).length

    // When twenty seconds pass, then forty
    await vi.advanceTimersByTimeAsync(20_000)
    const afterOne = harness.hub.calls.filter(call => call.path.endsWith('/renew-lease')).length
    await vi.advanceTimersByTimeAsync(20_000)
    const afterTwo = harness.hub.calls.filter(call => call.path.endsWith('/renew-lease')).length

    // Then one renewal per cadence reached the hub
    expect(afterOne).toBe(before + 1)
    expect(afterTwo).toBe(before + 2)
  })

  it('operator sees a reconnect re-establish the attempt without a second card or session', async () => {
    // Given a claimed issue already executing in one session
    harness = makeHarness()
    harness.hub.addIssue({ assigneeAgentId: 'agent_1' })
    await harness.service().sweep()
    await flush()
    expect(harness.tasks()).toHaveLength(1)
    expect(harness.creates).toHaveLength(1)

    // When the channel drops, the lease lapses on the hub and the backoff elapses
    harness.hub.drop()
    const claimed = harness.hub.issues.get('issue_1')
    if (claimed === undefined) throw new Error('the fake hub lost the issue')
    claimed.status = 'waiting_host'
    await vi.advanceTimersByTimeAsync(1_000)
    await flush()

    // Then the same attempt was re-established: one card, one session, attempt_1 kept
    expect(harness.tasks()).toHaveLength(1)
    expect(harness.creates).toHaveLength(1)
    const reclaims = harness.hub.calls.filter(call => call.path.endsWith('/claim') && (call.body as { execution_attempt_id?: string }).execution_attempt_id !== undefined)
    expect(reclaims.length).toBeGreaterThanOrEqual(1)
    expect(harness.hub.issues.get('issue_1')?.attemptId).toBe('attempt_1')
    expect(harness.hub.issues.get('issue_1')?.status).toBe('running')
  })

  it('operator sees the member preset pinned on the mirror card and the card started', async () => {
    // Given a board revision that keeps the draft execution targets
    harness = makeHarness()
    harness.hub.addIssue({ assigneeAgentId: 'agent_1' })

    // When the issue is claimed
    await harness.service().sweep()
    await flush()

    // Then the created card carries the member's own preset, and it ran
    const task = harness.tasks()[0]
    expect(task.mode).toBe('liangshen')
    expect(harness.creates).toHaveLength(1)
    expect(harness.service().summary().presetPin).toBe('supported')
  })

  it('operator sees a claimed card left unstarted and flagged when the board cannot pin a preset', async () => {
    // Given a board revision whose create drops the draft execution targets
    harness = makeHarness({ withDraftPreset: false })
    harness.hub.addIssue({ assigneeAgentId: 'agent_1' })

    // When the issue is claimed
    await harness.service().sweep()
    await flush()

    // Then nothing ran, the card records why, and the settings summary says it
    const task = harness.tasks()[0]
    expect(task.mode).toBeUndefined()
    expect(harness.creates).toHaveLength(0)
    expect(readTaskIssueLink(task)?.lastError).toContain('cannot pin an agent preset')
    expect(harness.service().summary().presetPin).toBe('missing')
    expect(harness.service().summary().problems.join(' ')).toContain('cannot pin an agent preset')
  })

  it('operator sees the registration body in snake_case with the agent records mapped back', async () => {
    // Given a Host binding one member that pins a preset, model and effort
    harness = makeHarness({
      agents: [boundAgent({ preset: 'liangshen', model: 'deepseek-chat', reasoningEffort: 'high' })],
    })
    harness.hub.addIssue({ assigneeAgentId: 'agent_1' })

    // When it registers and claims
    await harness.service().whenStarted()
    await harness.service().sweep()
    await flush()

    // Then the request body is snake_case end to end, and the response's agent
    // records are what mapped the member to its hub agent id
    const register = harness.hub.calls.find(call => call.path.endsWith('/hosts/register'))
    expect(register?.body).toEqual({
      hostname: 'test-host',
      client_version: '0.4.12',
      agents: [{ name: 'builder', preset_id: 'liangshen', model: 'deepseek-chat', reasoning_effort: 'high' }],
    })
    expect(harness.hub.registered).toEqual([{ id: 'agent_1', name: 'builder', preset_id: 'liangshen' }])
    expect(harness.service().summary().agents[0]?.hubAgentId).toBe('agent_1')
    expect(harness.tasks()).toHaveLength(1)
  })

  it('operator sees a member without a preset skipped instead of run under the default', async () => {
    // Given one member with a preset and one whose definition pins none
    harness = makeHarness({
      agents: [boundAgent(), boundAgent({ memberId: 'mem_bare', name: 'bare', preset: undefined })],
    })
    harness.hub.addIssue({ assigneeAgentId: 'agent_1' })

    // When it registers
    await harness.service().whenStarted()

    // Then only the preset-bearing member was reported, and the skip is visible
    const register = harness.hub.calls.find(call => call.path.endsWith('/hosts/register'))
    expect((register!.body as { agents: unknown[] }).agents).toEqual([{ name: 'builder', preset_id: 'liangshen' }])
    expect(harness.service().summary().problems.join(' ')).toContain('bare is not registered')
  })

  it('operator sees claim credentials survive an attempt the hub reports as null', async () => {
    // Given a card whose attempt the hub no longer holds, reported as null
    harness = makeHarness()
    harness.hub.addIssue({ assigneeAgentId: 'agent_1' })
    await harness.service().sweep()
    await flush()
    const issue = harness.hub.issues.get('issue_1')
    if (issue === undefined) throw new Error('the fake hub lost the issue')
    issue.attemptId = undefined
    issue.status = 'waiting_host'

    // When the claim sweep runs again
    await harness.service().sweep()

    // Then the previous attempt was presented instead of being read as a mismatch
    const claimCalls = harness.hub.calls.filter(call => call.path.endsWith('/claim'))
    const claimCall = claimCalls[claimCalls.length - 1]
    expect((claimCall!.body as { execution_attempt_id?: string }).execution_attempt_id).toBe('attempt_1')
  })

  it('operator sees a burst of channel events collapse into one claim sweep per cadence', async () => {
    // Given a registered Host whose channel is open
    harness = makeHarness()
    await harness.service().whenStarted()
    const before = harness.hub.calls.filter(call => call.method === 'GET' && call.path.endsWith('/issues')).length

    // When three issue events arrive inside one cadence window
    harness.hub.push('issue.created', { issue: { id: 'issue_x' } })
    harness.hub.push('issue.updated', { issue: { id: 'issue_x' }, changed_fields: ['title'] })
    harness.hub.push('issue.status_changed', { issue_id: 'issue_x', old_status: 'todo', new_status: 'assigned' })
    await flush()
    const duringWindow = harness.hub.calls.filter(call => call.method === 'GET' && call.path.endsWith('/issues')).length

    // Then nothing ran yet, and exactly one pass runs at the boundary
    expect(duringWindow).toBe(before)
    await vi.advanceTimersByTimeAsync(5_000)
    await flush()
    expect(harness.hub.calls.filter(call => call.method === 'GET' && call.path.endsWith('/issues')).length).toBe(before + 1)
  })

  it('operator sees a Host that binds no member claim nothing at all', async () => {
    // Given a Host whose bindings resolve to no dsh-agents member
    harness = makeHarness({ agents: [] })
    harness.hub.addIssue({ assigneeAgentId: 'agent_1' })

    // When it starts
    await harness.service().start()

    // Then it never registered and never claimed
    expect(harness.tasks()).toHaveLength(0)
    expect(harness.hub.calls.filter(call => call.path.endsWith('/claim')).length).toBe(0)
    expect(harness.service().summary().problems).toContain('no dsh-agents member is bound to this Host, so no issue is claimed')
  })

  it('operator sees a human retry of a mirrored card started again by the next sweep', async () => {
    // Given a card whose run failed and whose outcome the hub accepted
    harness = makeHarness()
    harness.hub.addIssue({ assigneeAgentId: 'agent_1' })
    await harness.service().sweep()
    await flush()
    const task = harness.tasks()[0]
    const execution = task.executions[task.executions.length - 1]
    harness.ledger.settle(task.id, execution.id, 'failed', 'the acceptance command exited 1')
    harness.board.extensions.emitExecutionSettled({
      taskId: task.id,
      executionId: execution.id,
      outcome: 'failed',
      error: 'the acceptance command exited 1',
    })
    await flush()
    const issue = harness.hub.issues.get('issue_1')
    if (issue === undefined) throw new Error('the fake hub lost the issue')
    expect(issue.status).toBe('failed')

    // When a human retries the card on the hub, moving the issue back to assigned
    issue.status = 'assigned'

    // When the sweep claims it again
    await harness.service().sweep()
    await flush()

    // Then the same card ran again in a new session, under the attempt the hub
    // minted for that run, and no second card appeared
    expect(harness.tasks()).toHaveLength(1)
    expect(harness.tasks()[0].executions).toHaveLength(2)
    expect(harness.creates).toHaveLength(2)
    expect(readTaskIssueLink(harness.tasks()[0])?.attemptId).toBe('attempt_2')
  })

  it('operator sees a reconnect whose lease moved away leave no error behind', async () => {
    // Given a running card whose lease on the hub now belongs to another attempt
    harness = makeHarness()
    harness.hub.addIssue({ assigneeAgentId: 'agent_1' })
    await harness.service().sweep()
    await flush()
    const taskId = harness.tasks()[0].id
    const issue = harness.hub.issues.get('issue_1')
    if (issue === undefined) throw new Error('the fake hub lost the issue')
    issue.leaseToken = 'lease_elsewhere'
    issue.status = 'waiting_host'

    // When the sweep reconnects with the attempt and lease this Host still holds
    await harness.service().sweep()
    await flush()

    // Then the reconnect presented its own attempt, the hub refused it, and this
    // Host recorded no failure for a race it lost
    const claims = harness.hub.calls.filter(call => call.path.endsWith('/claim'))
    const presented = claims[claims.length - 1]?.body as { execution_attempt_id?: string } | undefined
    expect(presented?.execution_attempt_id).toBe('attempt_1')
    expect(harness.tasks()).toHaveLength(1)
    expect(harness.tasks()[0].executions).toHaveLength(1)
    expect(harness.service().summary().connection.lastError).toBeUndefined()
    expect(harness.service().summary().cards[taskId]?.lastError).toBeUndefined()
    expect(readTaskIssueLink(harness.tasks()[0])?.lastError).toBeUndefined()
  })

  it('operator sees a member name another Host owns reported instead of run here', async () => {
    // Given a hub that already owns one of this Host's agent names
    harness = makeHarness()
    harness.hub.nameConflicts.set('builder', 'agent name already belongs to another host')
    harness.hub.addIssue({ assigneeAgentId: 'builder' })

    // When this Host registers and sweeps
    await harness.service().whenStarted()
    await harness.service().sweep()
    await flush()

    // Then the clash is visible in the summary, the member was not registered,
    // and nothing was claimed for it
    expect(harness.service().summary().problems.join(' '))
      .toContain('builder is not registered: agent name already belongs to another host')
    expect(harness.hub.registered).toEqual([])
    expect(harness.tasks()).toHaveLength(0)
    expect(harness.hub.calls.filter(call => call.path.endsWith('/claim'))).toHaveLength(0)
  })

  it('operator sees no issue claimed while this Host has no workspace to run it in', async () => {
    // Given a member whose team pins no workspace and a mount that configures none
    harness = makeHarness({ agents: [boundAgent({ workspaceId: undefined })] })
    harness.hub.addIssue({ assigneeAgentId: 'agent_1', title: 'Ship the thing' })

    // When two claim sweeps run
    await harness.service().sweep()
    await harness.service().sweep()
    await flush()

    // Then the hub was never asked to hand the issue over, no card was created,
    // and one problem line says why and what this Host does instead
    expect(harness.hub.calls.filter(call => call.path.endsWith('/claim'))).toHaveLength(0)
    expect(harness.hub.issues.get('issue_1')?.status).toBe('assigned')
    expect(harness.tasks()).toHaveLength(0)
    const missingWorkspace = harness.service().summary().problems.filter(line => line.includes('no run workspace'))
    expect(missingWorkspace).toHaveLength(1)
    expect(missingWorkspace[0]).toContain('no team issue is claimed')
    expect(missingWorkspace[0]).toContain('keep its issue running')
  })

  it('operator sees the configured workspace pinned on the mirror card and started', async () => {
    // Given a mount configured with the deployment workspace and a member whose team pins another
    harness = makeHarness({
      agents: [boundAgent({ workspaceId: 'ws_member' })],
      workspaceId: FIXTURE_WORKSPACE,
    })
    harness.hub.addIssue({ assigneeAgentId: 'agent_1' })

    // When the issue is claimed
    await harness.service().sweep()
    await flush()

    // Then the mount's workspace won over the member's, travelled into the card
    // and into the run the board opened for it
    expect(harness.hub.issues.get('issue_1')?.status).toBe('running')
    expect(harness.tasks()).toHaveLength(1)
    expect(harness.tasks()[0].workspaceId).toBe(FIXTURE_WORKSPACE)
    expect(harness.creates).toHaveLength(1)
    expect(harness.creates[0]?.workspaceId).toBe(FIXTURE_WORKSPACE)
  })

  it('operator sees the member team workspace used when the mount configures none', async () => {
    // Given a member whose team pins the deployment workspace and a mount with none
    harness = makeHarness({ agents: [boundAgent({ workspaceId: FIXTURE_WORKSPACE })] })
    harness.hub.addIssue({ assigneeAgentId: 'agent_1' })

    // When the issue is claimed
    await harness.service().sweep()
    await flush()

    // Then the card carries the member's own workspace and ran in it
    expect(harness.hub.issues.get('issue_1')?.status).toBe('running')
    expect(harness.tasks()).toHaveLength(1)
    expect(harness.tasks()[0].workspaceId).toBe(FIXTURE_WORKSPACE)
    expect(harness.creates).toHaveLength(1)
  })

  it('operator sees the missing workspace problem go once a workspace is configured', async () => {
    // Given a Host that already reported the missing workspace and claimed nothing
    harness = makeHarness({ agents: [boundAgent({ workspaceId: undefined })] })
    harness.hub.addIssue({ assigneeAgentId: 'agent_1' })
    await harness.service().sweep()
    expect(harness.service().summary().problems.filter(line => line.includes('no run workspace'))).toHaveLength(1)

    // When the mount's live settings gain the deployment workspace
    harness.settings.workspaceId = FIXTURE_WORKSPACE
    await harness.service().sweep()
    await flush()

    // Then the problem is gone and the issue was claimed into a card that runs there
    expect(harness.service().summary().problems.filter(line => line.includes('no run workspace'))).toHaveLength(0)
    expect(harness.hub.issues.get('issue_1')?.status).toBe('running')
    expect(harness.tasks()[0].workspaceId).toBe(FIXTURE_WORKSPACE)
    expect(harness.creates).toHaveLength(1)
  })
})