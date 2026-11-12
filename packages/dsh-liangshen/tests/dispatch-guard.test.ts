import { describe, expect, it } from 'vitest'

import {
  DEFAULT_COORDINATOR_TOOLS,
  DEFAULT_SHELL_TOOLS,
  apply,
  dispatchDenialReason,
  hasRunningChildSubagent,
  inject,
  installDispatchGuard,
  isDelegatedCaller,
  isPureSleepCommand,
  name,
} from '../presets/liangshen/dispatch-guard.mjs'

const DELEGATED_ASK = 'DELEGATED_CALLER: "ask_user_question" is a dispatch-level tool and a delegated subagent must not call it directly. '
  + 'Report back to the dispatcher instead: include status: "hand_back" or status: "blocked" '
  + 'and the unresolved question or decision in your report, and let the dispatcher act on it.'

const ACTIVE_CHILD_SLEEP = 'ACTIVE_CHILD_SLEEP_FORBIDDEN: a child subagent is still running, so sleeping to wait for it is not allowed. '
  + 'End your turn now and let the built-in subagent completion notification wake you.'

/** A caller whose durable session lineage records that it was delegated. */
function delegatedAgent(id = 'child-1', sessionId = 's-child-1') {
  return { id, session: { header: { id: sessionId, origin: 'subagent' } } }
}

/** A caller that is nobody's child: no delegation lineage in its header. */
function rootAgent(id = 'root-1', sessionId = 's-root-1') {
  return { id, session: { header: { id: sessionId, origin: 'user' } } }
}

/** A host whose optional services are reachable through `ctx.get`. */
function hostWith(services: Record<string, unknown>) {
  return { get: (serviceName: string) => services[serviceName] }
}

/** The argument bag a model sends to a shell tool. */
function shellArgs(command: string, background = false) {
  return background ? { command, run_in_background: true } : { command }
}

describe('liangshen-dispatch-guard', () => {
  it('operator sees the row register under its loader name and declare only the registry', () => {
    // Given the preset row, When the plugin loads, Then it carries the name the
    // loader reports and the two shipped tool lists.
    expect(name).toBe('liangshen-dispatch-guard')
    // Then: only `tools` is declared. `agents` and `subagents` are read through
    // `ctx.get()` at call time, so a host without them still mounts this row.
    expect(inject).toEqual(['tools'])
    expect(DEFAULT_COORDINATOR_TOOLS).toEqual([
      'ask_user_question',
      'enter_plan_mode',
      'leave_plan_mode',
      'exit_plan_mode',
      'create_goal',
      'update_goal',
      'present',
    ])
    expect(DEFAULT_SHELL_TOOLS).toEqual(['bash', 'pwsh', 'win_bash'])
    // Then: both lists are frozen, so no caller can widen the guard in place.
    expect(Object.isFrozen(DEFAULT_COORDINATOR_TOOLS)).toBe(true)
    expect(Object.isFrozen(DEFAULT_SHELL_TOOLS)).toBe(true)
  })

  it('operator judges a caller delegated from its durable lineage alone', () => {
    // Given a caller whose session header records the delegation, When the
    // identity is judged, Then no service has to answer at all.
    expect(isDelegatedCaller(delegatedAgent(), undefined)).toBe(true)
    expect(isDelegatedCaller(delegatedAgent(), hostWith({}))).toBe(true)
    // Then: lineage wins over a root set that would have called it a root.
    const child = delegatedAgent()
    const agents = { get: () => child, roots: () => [child] }
    expect(isDelegatedCaller(child, hostWith({ agents }))).toBe(true)
  })

  it('operator judges a caller delegated from the live root set when it has no lineage', () => {
    // Given a root-looking session that is absent from the live root set, When
    // the identity is judged, Then the host's own liveness check settles it.
    const child = rootAgent()
    const parents = [rootAgent('root-9', 's-root-9')]
    const agents = { get: (id: string) => (id === child.id ? child : undefined), roots: () => parents }
    expect(isDelegatedCaller(child, hostWith({ agents }))).toBe(true)
    // Then: an agent that IS a live root is not a child.
    const root = parents[0]
    const rooted = { get: (id: string) => (id === root.id ? root : undefined), roots: () => parents }
    expect(isDelegatedCaller(root, hostWith({ agents: rooted }))).toBe(false)
    // Then: on 0.2.2-rc.2+ hosts where agents.roots() is replaced by subagents.rootOf(caller), rootOf settles it.
    const rc2Agents = { get: (id: string) => (id === child.id ? child : id === root.id ? root : undefined) }
    const rc2Subagents = { rootOf: (candidate: unknown) => (candidate === child ? root : candidate) }
    expect(isDelegatedCaller(child, hostWith({ agents: rc2Agents, subagents: rc2Subagents }))).toBe(true)
    expect(isDelegatedCaller(root, hostWith({ agents: rc2Agents, subagents: rc2Subagents }))).toBe(false)
  })

  it('operator does not judge a stale caller a child', () => {
    // Given an agent object that the registry no longer holds under that id,
    // When the identity is judged, Then nothing is decided: a replaced caller is
    // not automatically a child, so the call passes through.
    const stale = rootAgent()
    const replacement = rootAgent()
    const agents = { get: () => replacement, roots: () => [replacement] }
    expect(isDelegatedCaller(stale, hostWith({ agents }))).toBe(false)
  })

  it('operator gets a false answer from every unreadable identity fact', () => {
    // Given a host that cannot answer, When the identity is judged, Then the
    // guard holds no opinion instead of guessing.
    expect(isDelegatedCaller(rootAgent(), undefined)).toBe(false)
    expect(isDelegatedCaller(rootAgent(), {})).toBe(false)
    expect(isDelegatedCaller(rootAgent(), hostWith({}))).toBe(false)
    // Then: no `roots` function, a throwing `roots`, and a throwing `get` are
    // all unreadable rather than "not a root".
    expect(isDelegatedCaller(rootAgent(), hostWith({ agents: { get: () => undefined } }))).toBe(false)
    expect(isDelegatedCaller(rootAgent(), hostWith({ agents: { roots: () => { throw new Error('x') } } }))).toBe(false)
    expect(isDelegatedCaller(rootAgent(), {
      get: () => { throw new Error('cannot get property "agents" without inject') },
    })).toBe(false)
    expect(isDelegatedCaller(undefined, undefined)).toBe(false)
  })

  it('operator recognises every shipped wait form as a pure sleep', () => {
    // Given statements that only wait, When each is classified, Then all of them
    // are waits, including the Windows and PowerShell spellings.
    for (const command of [
      'sleep 5',
      'sleep 1s',
      'SLEEP 2',
      'Start-Sleep -Seconds 2',
      'Start-Sleep -Milliseconds 500',
      'Start-Sleep 3',
      'timeout /t 10 /nobreak',
      'timeout 10',
      'timeout.exe /t 5',
      'ping -n 4 127.0.0.1',
      'ping -n 10 localhost',
      'sleep 1; sleep 2',
      'sleep 1 && ping -n 2 127.0.0.1',
      'sleep 2\necho waiting',
      '# wait for the child\nsleep 3',
      ': ; sleep 1',
    ]) {
      expect(isPureSleepCommand(command), command).toBe(true)
    }
  })

  it('operator lets every command that does real work through', () => {
    // Given a command with one statement that works, When it is classified, Then
    // it is not a wait: a legitimate command must never be refused.
    for (const command of [
      'sleep 1 && npm test',
      'timeout 10 && pnpm build',
      'git status',
      'echo hi',
      '# comment',
      'sleep 1 | cat',
      '',
      '   ',
    ]) {
      expect(isPureSleepCommand(command), command).toBe(false)
    }
    // Then: a non-string carries no command at all.
    expect(isPureSleepCommand(undefined)).toBe(false)
    expect(isPureSleepCommand(12)).toBe(false)
  })

  it('operator detects a running child through the subagents listing', () => {
    // Given a subagents service that answers for the caller, When the listing
    // carries a running child, Then the caller is reported as still busy.
    const child = rootAgent()
    const byScope = { list: (agent: unknown, scope?: string) => (scope === 'children' ? [{ id: 'c', status: 'running' }] : []) }
    expect(hasRunningChildSubagent(child, hostWith({ subagents: byScope }))).toBe(true)
    // Then: the older single-argument form answers just as well.
    const byAgent = { list: (_agent: unknown) => [{ id: 'c', status: 'inactive' }] }
    expect(hasRunningChildSubagent(child, hostWith({ subagents: byAgent }))).toBe(false)
    const running = { list: () => [{ id: 'c', status: 'running' }] }
    expect(hasRunningChildSubagent(child, hostWith({ subagents: running }))).toBe(true)
    // Then: a record wrapping the array is read too, under any of its keys.
    const wrapped = { list: () => ({ children: [{ id: 'c', status: 'running' }] }) }
    expect(hasRunningChildSubagent(child, hostWith({ subagents: wrapped }))).toBe(true)
    const entries = { list: () => ({ entries: [{ id: 'c', status: 'running' }] }) }
    expect(hasRunningChildSubagent(child, hostWith({ subagents: entries }))).toBe(true)
  })

  it('operator detects a running child through the agents listing parent link', () => {
    // Given a live agent table, When one running entry names the caller as its
    // parent, Then the caller is still busy. Both the agent id and the session
    // header id are accepted as the parent link.
    const child = rootAgent('root-1', 's-root-1')
    const byAgentId = { list: () => [{ id: 'c', status: 'running', parent: 'root-1' }] }
    expect(hasRunningChildSubagent(child, hostWith({ agents: byAgentId }))).toBe(true)
    const bySessionId = { list: () => [{ id: 'c', status: 'running', parent: 's-root-1' }] }
    expect(hasRunningChildSubagent(child, hostWith({ agents: bySessionId }))).toBe(true)
    // Then: somebody else's running child, and an idle one, are not the caller's.
    const foreign = { list: () => [{ id: 'c', status: 'running', parent: 'root-9' }] }
    expect(hasRunningChildSubagent(child, hostWith({ agents: foreign }))).toBe(false)
    const idle = { list: () => [{ id: 'c', status: 'inactive', parent: 'root-1' }] }
    expect(hasRunningChildSubagent(child, hostWith({ agents: idle }))).toBe(false)
    // Then: on 0.2.2-rc.2+ hosts where Agent entries expose running: true and session.header.parentSession, the child is detected too.
    const byHeaderParentSession = {
      list: () => [{ id: 'c', running: true, session: { header: { id: 's-c', parentSession: 's-root-1' } } }],
    }
    expect(hasRunningChildSubagent(child, hostWith({ agents: byHeaderParentSession }))).toBe(true)
  })

  it('operator honours a directly injected running-child callback', () => {
    // Given a host that injects the answer itself, When the callback is a
    // function, Then it decides instead of the host probes.
    const child = rootAgent()
    expect(hasRunningChildSubagent(child, { hasRunningChildren: () => true })).toBe(true)
    expect(hasRunningChildSubagent(child, { hasRunningChildren: () => false })).toBe(false)
    // Then: an answering subagents listing is overridden by the callback.
    const listing = { subagents: { list: () => [{ id: 'c', status: 'running' }] } }
    expect(hasRunningChildSubagent(child, { ...listing, hasRunningChildren: () => false })).toBe(false)
    // Then: a throwing callback is unreadable, not "running".
    expect(hasRunningChildSubagent(child, { hasRunningChildren: () => { throw new Error('x') } })).toBe(false)
  })

  it('operator gets a false answer from every unreadable running-child fact', () => {
    // Given a host that cannot answer, When the running-child test runs, Then
    // the guard holds no opinion.
    const child = rootAgent()
    expect(hasRunningChildSubagent(child, undefined)).toBe(false)
    expect(hasRunningChildSubagent(child, hostWith({}))).toBe(false)
    expect(hasRunningChildSubagent(child, hostWith({
      subagents: { list: () => { throw new Error('x') } },
      agents: { list: () => { throw new Error('y') } },
    }))).toBe(false)
    expect(hasRunningChildSubagent(undefined, undefined)).toBe(false)
  })

  it('operator cannot let a delegated child drive the decision tools', () => {
    // Given a delegated caller, When it calls each decision tool the preset
    // actually mounts, Then every call is refused with the hand-back contract.
    const child = delegatedAgent()
    for (const toolName of ['ask_user_question', 'create_goal', 'update_goal', 'exit_plan_mode', 'present']) {
      const denial = dispatchDenialReason({ agent: child, toolName, args: {}, ctx: hostWith({}) })
      expect(denial).toContain(`DELEGATED_CALLER: "${toolName}"`)
      expect(denial).toContain('status: "hand_back"')
    }
    // Then: the text is the whole contract, not a prefix of it.
    expect(dispatchDenialReason({ agent: child, toolName: 'ask_user_question', args: {}, ctx: hostWith({}) }))
      .toBe(DELEGATED_ASK)
  })

  it('operator lets a coordinator call and an ordinary tool through', () => {
    // Given a root caller, When it calls a decision tool, Then nothing is
    // refused: the guard polices who called, not the tool.
    const root = rootAgent()
    const parents = [root]
    const agents = { get: (id: string) => (id === root.id ? root : undefined), roots: () => parents }
    expect(dispatchDenialReason({ agent: root, toolName: 'ask_user_question', args: {}, ctx: hostWith({ agents }) }))
      .toBeUndefined()
    // Then: a delegated caller keeps every tool that is not on the list.
    expect(dispatchDenialReason({ agent: delegatedAgent(), toolName: 'read', args: {}, ctx: hostWith({}) }))
      .toBeUndefined()
    expect(dispatchDenialReason({ agent: delegatedAgent(), toolName: 'run_code', args: {}, ctx: hostWith({}) }))
      .toBeUndefined()
  })

  it('operator cannot sleep while a child is still running', () => {
    // Given a caller with a running child, When it sleeps in the foreground,
    // Then the call is refused and told to end its turn instead.
    const root = rootAgent()
    const denial = dispatchDenialReason({
      agent: root,
      toolName: 'bash',
      args: shellArgs('sleep 30'),
      ctx: hostWith({}),
      hasRunningChildren: () => true,
    })
    expect(denial).toBe(ACTIVE_CHILD_SLEEP)
    // Then: every shell tool on the list is guarded, not just bash.
    for (const toolName of ['bash', 'pwsh', 'win_bash']) {
      expect(dispatchDenialReason({
        agent: root, toolName, args: shellArgs('Start-Sleep -Seconds 5'), ctx: hostWith({}),
        hasRunningChildren: () => true,
      })).toBe(ACTIVE_CHILD_SLEEP)
    }
  })

  it('operator may sleep when no child is running or the wait is backgrounded', () => {
    // Given no running child, When the caller sleeps, Then the command is an
    // ordinary one and passes through.
    const root = rootAgent()
    expect(dispatchDenialReason({
      agent: root, toolName: 'bash', args: shellArgs('sleep 5'), ctx: hostWith({}),
      hasRunningChildren: () => false,
    })).toBeUndefined()
    // Then: a backgrounded command is not a wait the caller sits in.
    expect(dispatchDenialReason({
      agent: root, toolName: 'bash', args: shellArgs('sleep 5', true), ctx: hostWith({}),
      hasRunningChildren: () => true,
    })).toBeUndefined()
    // Then: a command that does real work is never refused, even beside a wait.
    expect(dispatchDenialReason({
      agent: root, toolName: 'bash', args: shellArgs('sleep 1 && npm test'), ctx: hostWith({}),
      hasRunningChildren: () => true,
    })).toBeUndefined()
    // Then: a shell call that carries no command says nothing.
    expect(dispatchDenialReason({
      agent: root, toolName: 'bash', args: {}, ctx: hostWith({}), hasRunningChildren: () => true,
    })).toBeUndefined()
  })

  it('operator gets the running-child answer from the host when none is injected', () => {
    // Given a subagents listing that answers, When a pure sleep is dispatched,
    // Then the host probe decides and the denial still lands.
    const root = rootAgent()
    const subagents = { list: () => [{ id: 'c', status: 'running' }] }
    expect(dispatchDenialReason({
      agent: root, toolName: 'bash', args: shellArgs('sleep 5'), ctx: hostWith({ subagents }),
    })).toBe(ACTIVE_CHILD_SLEEP)
    // Then: an unreadable host probe is a pass, never a throw.
    expect(dispatchDenialReason({
      agent: root, toolName: 'bash', args: shellArgs('sleep 5'), ctx: hostWith({ subagents: { list: () => { throw new Error('x') } } }),
    })).toBeUndefined()
    // Then: a throwing injected callback is a pass as well.
    expect(dispatchDenialReason({
      agent: root, toolName: 'bash', args: shellArgs('sleep 5'), ctx: hostWith({}),
      hasRunningChildren: () => { throw new Error('x') },
    })).toBeUndefined()
  })

  it('operator can retune both policed lists from the row configuration', () => {
    // Given a configured coordinator list, When a tool outside it is called by a
    // delegated child, Then the call passes; the shipped list is not consulted.
    const child = delegatedAgent()
    expect(dispatchDenialReason({
      agent: child, toolName: 'ask_user_question', args: {}, ctx: hostWith({}), coordinatorTools: ['present'],
    })).toBeUndefined()
    // Then: a configured shell list guards the tool it names and nothing else.
    const root = rootAgent()
    expect(dispatchDenialReason({
      agent: root, toolName: 'bash', args: shellArgs('sleep 5'), ctx: hostWith({}),
      shellTools: ['pwsh'], hasRunningChildren: () => true,
    })).toBeUndefined()
    expect(dispatchDenialReason({
      agent: root, toolName: 'pwsh', args: shellArgs('sleep 5'), ctx: hostWith({}),
      shellTools: ['pwsh'], hasRunningChildren: () => true,
    })).toBe(ACTIVE_CHILD_SLEEP)
  })

  it('operator gets the guard registered on the registry seam alone', () => {
    // Given a registry that exposes the guard seam, When the row mounts, Then one
    // guard is registered and it refuses a delegated decision call.
    const registered: ((execution: unknown) => string | undefined)[] = []
    let disposed = 0
    const tools = {
      guard: (fn: (execution: unknown) => string | undefined) => {
        registered.push(fn)
        return () => { disposed += 1 }
      },
    }
    const ctx = {
      tools,
      effect: (fn: () => () => void) => { fn() },
    }
    apply(ctx, {})
    expect(registered).toHaveLength(1)
    const child = delegatedAgent()
    expect(registered[0]({ name: 'read', arguments: {}, agent: child })).toBeUndefined()
    expect(registered[0]({ name: 'ask_user_question', arguments: {}, agent: child })).toBe(DELEGATED_ASK)
    // Then: the disposer the row hands to `effect` is the host's own.
    const dispose = installDispatchGuard(ctx, {})
    expect(typeof dispose).toBe('function')
    dispose?.()
    expect(disposed).toBe(1)
  })

  it('operator gets no guard from a scope without the seam, and a clean dispose', () => {
    // Given a host with no `tools.guard`, When the row mounts, Then it installs
    // nothing and `effect` still receives a disposer.
    expect(installDispatchGuard({}, {})).toBeUndefined()
    expect(installDispatchGuard({ tools: {} }, {})).toBeUndefined()
    let effects = 0
    const bare = {
      effect: (fn: () => unknown) => { effects += 1; expect(typeof fn()).toBe('function') },
    }
    apply(bare, {})
    expect(effects).toBe(1)
  })

  it('operator can switch the guard off from the row configuration', () => {
    // Given the row switched off, When the preset mounts it, Then no guard is
    // registered at all.
    let calls = 0
    const ctx = {
      tools: { guard: () => { calls += 1; return () => undefined } },
      effect: (fn: () => () => void) => { fn() },
    }
    apply(ctx, { enabled: false })
    expect(calls).toBe(0)
  })
})
