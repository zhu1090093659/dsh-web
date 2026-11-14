/**
 * Host pwsh replacement: which sessions lose the host's PowerShell tool once
 * win_bash serves them, which keep it, and what puts it back.
 *
 * The contract under test is "win_bash can serve this session", NOT "win_bash
 * is mounted": win_bash runs only in a danger-full-access session, so a
 * restricted session must keep pwsh or it would have no shell at all. The fake
 * context therefore carries the sandbox policy service beside the tools
 * registry, and every session carries the mode the policy answers with.
 *
 * The platform is passed EXPLICITLY in the module-level cases rather than read
 * from the runner, because the contract is "Windows hides, POSIX does not" - a
 * suite that inherited process.platform could only ever assert one half of it.
 * The registration cases do carry a Windows gate, since there the mount is
 * production's own registration path. Nothing here waits on real time: mode
 * switches are driven by the module's own listener through the structural
 * event trigger.
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { installPwshReplacement, registerWinBash } from '../src/index.ts'
import { CONFIG_DEFAULTS, resolveConfig } from '../src/config.ts'
import { resolveRuntime } from '../src/runtime.ts'

const runtime = resolveRuntime({ platform: process.platform, arch: process.arch })
const isWindowsX64 = process.platform === 'win32' && process.arch === 'x64'

/** One session's scoped tools view, its sandbox mode, and what it has received. */
interface Session {
  /** The names that session's model can currently see. */
  readonly names: string[]
  /** Every deny set that session's scope was restricted with. */
  readonly restrictions: string[][]
  /** How many times the session's restriction was lifted. */
  lifts: number
  /** The host event handlers the module installed, by event name. */
  readonly handlers: Map<string, (...args: any[]) => void>
  /** The session's own sandbox mode, as the policy service answers for it. */
  mode: SandboxMode
  /** The session object the module matches its log events against. */
  readonly session: { readonly id: string, readonly header?: { readonly cwd?: string } }
}

/** Distinguishes the stand-in sessions of one suite, so none shares an identity. */
let sessionCounter = 0

/**
 * One stand-in session: a scoped tools view that records the restriction it
 * receives and lifts it the way the registry's own disposer would.
 * @param names - the tool names this session starts out seeing.
 * @param mode - the sandbox mode this session's policy answers with.
 * @returns the session, plus the agent object the host would hand the module.
 */
function session(
  names: readonly string[],
  mode: SandboxMode = 'danger-full-access',
): { agent: { ctx: { tools: { restrict: any } }, session: { id: string, header: { cwd: string } } }, state: Session } {
  sessionCounter += 1
  // A real Session always carries a header, and tool.ts refuses a session whose
  // header has no working directory — so the stand-in carries one too rather
  // than reading as the cwd-less case by accident.
  const sessionRef = { id: 'session-' + sessionCounter.toString(), header: { cwd: 'C:/workspace' } }
  const state: Session = {
    names: [...names], restrictions: [], lifts: 0, handlers: new Map(), mode, session: sessionRef,
  }
  const tools = {
    restrict: (filter: { deny: readonly string[] }) => {
      state.restrictions.push([...filter.deny])
      state.names.splice(0, state.names.length, ...state.names.filter(name => !filter.deny.includes(name)))
      return () => {
        state.lifts += 1
        state.names.splice(0, state.names.length, ...names)
      }
    },
  }
  return { agent: { ctx: { tools }, session: sessionRef }, state }
}

/** Everything one install run did, recorded instead of asserted on a mock. */
interface Recorded {
  /** The sessions this install may act on, in roster order. */
  readonly sessions: { agent: unknown, state: Session }[]
  /** Every registration the module installed, by event name. */
  readonly listeners: string[]
  /** The registrations the module asked to receive globally. */
  readonly globalListeners: string[]
  /** The handler installed for one event name, whichever session it belongs to. */
  readonly handlers: Map<string, (...args: any[]) => void>
  /** Every fiber effect the module installed. */
  effects: number
  /** Warning lines the module emitted. */
  readonly warnings: string[]
  /** How many times a model-facing surface was read. */
  schemaReads: number
  /** How many times the session roster was read. */
  rosterReads: number
  /** How many times the sandbox policy service was asked about a session. */
  policyReads: number
}

/** How the fake deployment publishes its sandbox policy, if at all. */
type PolicyShape = 'service' | 'absent' | 'throws' | 'invalid'

/**
 * A structural host context publishing one tools service, one session roster
 * and one sandbox policy service, with no real cordis behind it.
 * @param sessions - the sessions this host serves.
 * @param options - rosterThrows: refuse every roster read; policy: how the
 * policy service behaves (absent, throwing, or answering outside the vocabulary).
 * @returns the context and the sink its interactions are recorded in.
 */
function hostContext(
  sessions: { agent: unknown, state: Session }[] = [],
  options: { rosterThrows?: boolean, policy?: PolicyShape } = {},
): { ctx: Context, recorded: Recorded } {
  const recorded: Recorded = {
    sessions, listeners: [], globalListeners: [], handlers: new Map(), effects: 0, warnings: [],
    schemaReads: 0, rosterReads: 0, policyReads: 0,
  }
  const byAgent = new Map(sessions.map(entry => [entry.agent, entry.state]))
  const bySession = new Map(sessions.map(entry => [entry.state.session, entry.state]))
  const context = {
    logger: { info: () => {}, warn: (message: string) => { recorded.warnings.push(message) }, error: () => {} },
    get: (service: string) => {
      if (service === 'tools') {
        return {
          schemas: (agent?: unknown) => {
            recorded.schemaReads += 1
            return (byAgent.get(agent)?.names ?? []).map(name => ({ name }))
          },
        }
      }
      if (service === 'sandboxPolicy') {
        if (options.policy === 'absent') return undefined
        return {
          resolve: (request?: { session?: unknown }) => {
            recorded.policyReads += 1
            if (options.policy === 'throws') throw new Error('policy unavailable')
            if (options.policy === 'invalid') return { mode: 'root-access', workspaceRoot: process.cwd() }
            // The fallback mirrors a deployment whose default is full access,
            // so a test that omits the session is decided by the module's own
            // refusal to guess, not by the service's answer.
            return {
              mode: bySession.get(request?.session as Session['session'])?.mode ?? 'danger-full-access',
              workspaceRoot: process.cwd(),
            }
          },
        }
      }
      if (service !== 'agents') return undefined
      return {
        list: () => {
          recorded.rosterReads += 1
          if (options.rosterThrows === true) throw new Error('roster unavailable')
          return sessions.map(entry => entry.agent)
        },
      }
    },
    on: (event: string, handler: (...args: any[]) => void, listenerOptions?: { global?: boolean }) => {
      recorded.listeners.push(event)
      if (listenerOptions?.global === true) recorded.globalListeners.push(event)
      recorded.handlers.set(event, handler)
      for (const entry of sessions) entry.state.handlers.set(event, handler)
      return () => {}
    },
    effect: (body: () => unknown) => { recorded.effects += 1; return body() },
  } as unknown as Context
  return { ctx: context, recorded }
}

/**
 * Switch one session's sandbox mode the way the host does: one sandbox/mode
 * event on that session's log, announced through the dispatch seam the module
 * listens on. The policy service reads the session's new mode from then on.
 * @param state - the session being switched.
 * @param recorded - the sink carrying the installed listener.
 * @param mode - the mode the session moves to.
 */
function switchMode(state: Session, recorded: Recorded, mode: SandboxMode): void {
  state.mode = mode
  recorded.handlers.get('internal/dispatch')?.('emit', 'session/event', [
    state.session,
    { type: 'sandbox/mode', data: { mode } },
  ])
}

describe('the host pwsh replacement on Windows', () => {
  it('operator whose session sees pwsh loses that one tool and keeps every other', () => {
    // Given a Windows host whose full-access session surface carries the
    // private shell, the host shell, and an unrelated tool,
    const { agent, state } = session(['win_bash', 'pwsh', 'read'])
    const { ctx } = hostContext([{ agent, state }])
    // When the replacement is installed for Windows,
    installPwshReplacement(ctx, { platform: 'win32' })
    // Then exactly pwsh was withdrawn from that session and nothing else was
    // touched, so the model still sees the shell replacement and the files.
    expect(state.restrictions).toEqual([['pwsh']])
    expect(state.names).toEqual(['win_bash', 'read'])
  })

  it('operator sees the host shell come back when that session is disposed', () => {
    // Given a full-access session whose pwsh was withdrawn,
    const { agent, state } = session(['win_bash', 'pwsh'])
    const { ctx } = hostContext([{ agent, state }])
    installPwshReplacement(ctx, { platform: 'win32' })
    // When that session ends,
    state.handlers.get('agent/disposed')?.({ agent })
    // Then the restriction was lifted exactly once and the host shell is back
    // on the session's surface.
    expect(state.lifts).toBe(1)
    expect(state.names).toEqual(['win_bash', 'pwsh'])
  })

  it('operator whose session never saw pwsh gets no restriction at all', () => {
    // Given a full-access session whose surface carries win_bash and nothing else,
    const { agent, state } = session(['win_bash'])
    const { ctx } = hostContext([{ agent, state }])
    // When the replacement is installed,
    installPwshReplacement(ctx, { platform: 'win32' })
    // Then nothing is restricted and nothing is reported: a registry that does
    // not know the name would refuse the filter, and "not registered" is an
    // ordinary state rather than a defect.
    expect(state.restrictions).toEqual([])
    expect(state.names).toEqual(['win_bash'])
  })

  it('operator mounting before the host shell row registers still gets it hidden when it lands', () => {
    // Given a full-access session whose surface does not carry pwsh yet,
    // because the host's own shell row mounts in a later loader group,
    const { agent, state } = session(['win_bash'])
    const { ctx, recorded } = hostContext([{ agent, state }])
    installPwshReplacement(ctx, { platform: 'win32' })
    expect(recorded.listeners).toContain('tools/change')
    expect(state.restrictions).toEqual([])
    // When that row lands and the registry announces the surface change,
    state.names.push('pwsh')
    state.handlers.get('tools/change')?.()
    // Then the session loses pwsh from that moment on, with no boot-time wait
    // and no poll.
    expect(state.restrictions).toEqual([['pwsh']])
    expect(state.names).toEqual(['win_bash'])
  })

  it('operator unloading the plugin gets the host shell back for every session it hid', () => {
    // Given two full-access sessions whose pwsh was withdrawn and a third that
    // never had it on the surface,
    const a = session(['win_bash', 'pwsh'])
    const b = session(['win_bash', 'pwsh'])
    const c = session(['win_bash'])
    const { ctx, recorded } = hostContext([a, b, c])
    let unload: (() => void) | undefined
    ;(ctx as unknown as { effect: (body: () => unknown) => unknown }).effect = (body) => {
      recorded.effects += 1
      const disposer = body()
      if (typeof disposer === 'function') unload = disposer as () => void
      return disposer
    }
    installPwshReplacement(ctx, { platform: 'win32' })
    expect(a.state.names).toEqual(['win_bash'])
    expect(c.state.restrictions).toEqual([])
    // When the plugin fiber unloads,
    unload?.()
    // Then every session has the host shell back, and the one that never lost
    // it is unchanged.
    expect(a.state.names).toEqual(['win_bash', 'pwsh'])
    expect(b.state.names).toEqual(['win_bash', 'pwsh'])
    expect(c.state.names).toEqual(['win_bash'])
  })

  it('operator whose session roster cannot be read keeps the host shell and gets a warning', () => {
    // Given a deployment whose agent registry refuses its own roster read,
    const { ctx, recorded } = hostContext([], { rosterThrows: true })
    // When the replacement is installed,
    installPwshReplacement(ctx, { platform: 'win32' })
    // Then it reports the reach it did not have, instead of failing silently
    // or restricting a surface nobody read.
    expect(recorded.warnings.length).toBeGreaterThan(0)
    expect(recorded.warnings.join('\n')).toContain('could not be read')
    expect(recorded.schemaReads).toBe(0)
  })

  it('operator whose session has no working directory keeps the host shell, because win_bash refuses it too', () => {
    // Given a full-access session with no cwd — SessionHeader.cwd is optional in
    // the SDK, and tool.ts refuses exactly this session for exactly this reason,
    const state: Session = {
      names: ['win_bash', 'pwsh'], restrictions: [], lifts: 0, handlers: new Map(),
      mode: 'danger-full-access', session: { id: 'session-no-cwd' },
    }
    const agent = { ctx: { tools: { restrict: (filter: { deny: readonly string[] }) => {
      state.restrictions.push([...filter.deny])
      return () => {}
    } } }, session: state.session }
    const { ctx } = hostContext([{ agent, state }])
    // When the replacement is installed,
    installPwshReplacement(ctx, { platform: 'win32' })
    // Then pwsh stays: the mode alone would have withdrawn it, and this session
    // would have been left with neither shell.
    expect(state.restrictions).toEqual([])
    expect(state.names).toContain('pwsh')
  })

  it('operator whose session exposes no scoped tools view keeps the host shell and gets a warning', () => {
    // Given a full-access session that exposes no scoped view to restrict through,
    // built with a real header so it reaches the scoped-view check rather than
    // being refused earlier for having no working directory.
    const state: Session = {
      names: ['win_bash', 'pwsh'], restrictions: [], lifts: 0, handlers: new Map(),
      mode: 'danger-full-access', session: { id: 'session-no-scope', header: { cwd: 'C:/workspace' } },
    }
    const agent = { ctx: {}, session: state.session }
    const { ctx, recorded } = hostContext([{ agent, state }])
    // When the replacement is installed,
    installPwshReplacement(ctx, { platform: 'win32' })
    // Then no restriction is attempted and the operator is told why the host
    // shell is still listed.
    expect(state.restrictions).toEqual([])
    expect(recorded.warnings.join('\n')).toContain('no scoped tools view')
  })
})

describe('the replacement follows whether win_bash can serve the session', () => {
  it('operator on a read-only session keeps the host shell, because win_bash refuses it', () => {
    // Given a session the user restricted to read-only, where win_bash refuses
    // every call before a process is started,
    const { agent, state } = session(['win_bash', 'pwsh'], 'read-only')
    const { ctx } = hostContext([{ agent, state }])
    // When the replacement is installed,
    installPwshReplacement(ctx, { platform: 'win32' })
    // Then pwsh is still there: withdrawing it would leave the session with no
    // shell it can run anything in.
    expect(state.restrictions).toEqual([])
    expect(state.names).toEqual(['win_bash', 'pwsh'])
  })

  it('operator on a workspace-write session keeps the host shell by the same rule', () => {
    // Given a session in the other restricted mode,
    const { agent, state } = session(['win_bash', 'pwsh'], 'workspace-write')
    const { ctx } = hostContext([{ agent, state }])
    // When the replacement is installed,
    installPwshReplacement(ctx, { platform: 'win32' })
    // Then the answer is the same as for read-only: only danger-full-access is
    // a session win_bash can serve.
    expect(state.restrictions).toEqual([])
    expect(state.names).toEqual(['win_bash', 'pwsh'])
  })

  it('operator whose deployment composes no policy service keeps the host shell and is warned', () => {
    // Given a deployment with no sandbox policy service at all, where win_bash
    // refuses every call for want of an authoritative mode,
    const { agent, state } = session(['win_bash', 'pwsh'])
    const { ctx, recorded } = hostContext([{ agent, state }], { policy: 'absent' })
    // When the replacement is installed,
    installPwshReplacement(ctx, { platform: 'win32' })
    // Then pwsh stays, and the operator is told why rather than left to read
    // this as the replacement being broken.
    expect(state.restrictions).toEqual([])
    expect(state.names).toEqual(['win_bash', 'pwsh'])
    expect(recorded.warnings.join('\n')).toContain('could not be resolved')
  })

  it('operator whose policy service throws keeps the host shell', () => {
    // Given a policy service that refuses to answer,
    const { agent, state } = session(['win_bash', 'pwsh'])
    const { ctx } = hostContext([{ agent, state }], { policy: 'throws' })
    // When the replacement is installed,
    installPwshReplacement(ctx, { platform: 'win32' })
    // Then an unreadable policy is not treated as a yes: the session keeps the
    // only shell it can be sure of.
    expect(state.restrictions).toEqual([])
    expect(state.names).toEqual(['win_bash', 'pwsh'])
  })

  it('operator whose policy answers outside the closed vocabulary keeps the host shell', () => {
    // Given a policy service that answers with a mode this vocabulary does not
    // contain,
    const { agent, state } = session(['win_bash', 'pwsh'])
    const { ctx } = hostContext([{ agent, state }], { policy: 'invalid' })
    // When the replacement is installed,
    installPwshReplacement(ctx, { platform: 'win32' })
    // Then the answer is not read as danger-full-access, and pwsh stays.
    expect(state.restrictions).toEqual([])
    expect(state.names).toEqual(['win_bash', 'pwsh'])
  })

  it('operator whose agent exposes no session keeps the host shell', () => {
    // Given an agent whose session cannot be read, so its mode cannot be asked
    // for at all,
    const state: Session = {
      names: ['win_bash', 'pwsh'], restrictions: [], lifts: 0, handlers: new Map(),
      mode: 'danger-full-access', session: { id: 'session-absent' },
    }
    const calls: string[][] = []
    const agent = { ctx: { tools: { restrict: (filter: { deny: readonly string[] }) => { calls.push([...filter.deny]); return () => {} } } } }
    const { ctx } = hostContext([{ agent, state }])
    // When the replacement is installed,
    installPwshReplacement(ctx, { platform: 'win32' })
    // Then no restriction was even attempted, and the session's surface still
    // lists the host shell: without a session there is no mode to verify, and
    // an unverified mode is not a yes.
    expect(calls).toEqual([])
    expect(state.names).toEqual(['win_bash', 'pwsh'])
  })

  it('operator using an injected policy decision has it honoured over the composed service', () => {
    // Given a deployment whose composed service would say full access, and a
    // caller that injects its own authority,
    const { agent, state } = session(['win_bash', 'pwsh'], 'danger-full-access')
    const { ctx, recorded } = hostContext([{ agent, state }])
    // When the replacement is installed with an injected read-only verdict,
    installPwshReplacement(ctx, {
      platform: 'win32',
      policy: { resolve: () => ({ mode: 'read-only' }) },
    })
    // Then the injected authority decided and the composed service was never
    // consulted: the decision is injectable, and it is the one that counts.
    expect(state.restrictions).toEqual([])
    expect(state.names).toEqual(['win_bash', 'pwsh'])
    expect(recorded.policyReads).toBe(0)
  })
})

describe('the replacement follows a mode switch made mid-session', () => {
  it('operator restricting a running session gets the host shell back immediately', () => {
    // Given a full-access session whose pwsh was already withdrawn,
    const { agent, state } = session(['win_bash', 'pwsh'])
    const { ctx, recorded } = hostContext([{ agent, state }])
    installPwshReplacement(ctx, { platform: 'win32' })
    expect(state.names).toEqual(['win_bash'])
    // When the user switches that session to read-only, which the host records
    // as one sandbox/mode event on that session's log,
    switchMode(state, recorded, 'read-only')
    // Then the restriction is lifted at once: the session has its shell back
    // for the whole time win_bash refuses it.
    expect(state.lifts).toBe(1)
    expect(state.names).toEqual(['win_bash', 'pwsh'])
    expect(state.restrictions).toEqual([['pwsh']])
  })

  it('operator returning a session to full access gets the host shell withdrawn again', () => {
    // Given a session that started restricted, so pwsh was never withdrawn,
    const { agent, state } = session(['win_bash', 'pwsh'], 'read-only')
    const { ctx, recorded } = hostContext([{ agent, state }])
    installPwshReplacement(ctx, { platform: 'win32' })
    expect(state.restrictions).toEqual([])
    // When the user grants that session danger-full-access,
    switchMode(state, recorded, 'danger-full-access')
    // Then win_bash can serve it from that moment, and pwsh comes off the
    // surface without waiting for a remount.
    expect(state.restrictions).toEqual([['pwsh']])
    expect(state.names).toEqual(['win_bash'])
  })

  it('operator switching one session leaves another session of the same host alone', () => {
    // Given two full-access sessions whose pwsh was withdrawn,
    const a = session(['win_bash', 'pwsh'])
    const b = session(['win_bash', 'pwsh'])
    const { ctx, recorded } = hostContext([a, b])
    installPwshReplacement(ctx, { platform: 'win32' })
    // When only the first is restricted,
    switchMode(a.state, recorded, 'read-only')
    // Then only that session's shell came back: the mode event belongs to one
    // session, and so does the restriction.
    expect(a.state.names).toEqual(['win_bash', 'pwsh'])
    expect(b.state.names).toEqual(['win_bash'])
    expect(b.state.lifts).toBe(0)
  })

  it('operator switching modes on an unrelated session leaves this one untouched', () => {
    // Given a withdrawn full-access session and a different session's log,
    const { agent, state } = session(['win_bash', 'pwsh'])
    const other = session(['win_bash', 'pwsh'], 'read-only')
    const { ctx, recorded } = hostContext([{ agent, state }, other])
    installPwshReplacement(ctx, { platform: 'win32' })
    expect(state.names).toEqual(['win_bash'])
    // When that other session switches mode,
    switchMode(other.state, recorded, 'danger-full-access')
    // Then this session's restriction is neither lifted nor re-installed.
    expect(state.names).toEqual(['win_bash'])
    expect(state.lifts).toBe(0)
  })

  it('operator switching a session that win_bash still cannot serve changes nothing', () => {
    // Given a restricted session whose pwsh was deliberately kept,
    const { agent, state } = session(['win_bash', 'pwsh'], 'read-only')
    const { ctx, recorded } = hostContext([{ agent, state }])
    installPwshReplacement(ctx, { platform: 'win32' })
    // When it switches to the other restricted mode,
    switchMode(state, recorded, 'workspace-write')
    // Then nothing is withdrawn and nothing is lifted: both restricted modes
    // are sessions win_bash refuses.
    expect(state.restrictions).toEqual([])
    expect(state.lifts).toBe(0)
    expect(state.names).toEqual(['win_bash', 'pwsh'])
  })

  it('operator relies on a global mode listener, because the log event is not scoped to this plugin', () => {
    // Given an installed replacement,
    const { agent, state } = session(['win_bash', 'pwsh'])
    const { ctx, recorded } = hostContext([{ agent, state }])
    // When the install registered its listeners,
    installPwshReplacement(ctx, { platform: 'win32' })
    // Then the mode listener is registered globally: a session's own log event
    // is not dispatched to this plugin's scope, so a scoped listener would
    // never see the switch.
    expect(recorded.listeners).toContain('internal/dispatch')
    expect(recorded.globalListeners).toEqual(['internal/dispatch'])
  })

  it('operator restarting a session leaves no stale restriction behind', () => {
    // Given a full-access session whose pwsh was withdrawn and then restored by
    // a switch to read-only,
    const { agent, state } = session(['win_bash', 'pwsh'])
    const { ctx, recorded } = hostContext([{ agent, state }])
    installPwshReplacement(ctx, { platform: 'win32' })
    switchMode(state, recorded, 'read-only')
    expect(state.lifts).toBe(1)
    // When the user grants full access again,
    switchMode(state, recorded, 'danger-full-access')
    // Then exactly one new restriction was installed, and the session is back
    // to the hidden state with no double restriction and no leaked disposer.
    expect(state.restrictions).toEqual([['pwsh'], ['pwsh']])
    expect(state.names).toEqual(['win_bash'])
    expect(state.lifts).toBe(1)
  })
})

describe('the host pwsh replacement off Windows', () => {
  it('operator on a POSIX host gets no listener, no effect and no restriction', () => {
    // Given a POSIX host whose full-access session surface would match the deny
    // name,
    const { agent, state } = session(['win_bash', 'pwsh'])
    const { ctx, recorded } = hostContext([{ agent, state }])
    // When the replacement is installed there,
    installPwshReplacement(ctx, { platform: 'linux' })
    // Then not one side effect was produced: no event listener, no fiber
    // effect, no surface read, no roster read, no policy read, and no
    // restriction. The Windows ladder must not reach a POSIX deployment at all.
    expect(recorded.listeners).toEqual([])
    expect(recorded.effects).toBe(0)
    expect(recorded.schemaReads).toBe(0)
    expect(recorded.rosterReads).toBe(0)
    expect(recorded.policyReads).toBe(0)
    expect(state.restrictions).toEqual([])
    expect(state.names).toEqual(['win_bash', 'pwsh'])
  })

  it('operator on macOS gets the same total no-op, and a later session is unaffected', () => {
    // Given a macOS host where the install produced nothing,
    const { ctx, recorded } = hostContext([])
    installPwshReplacement(ctx, { platform: 'darwin' })
    // When a session starts afterwards and the host would have announced it,
    const { agent, state } = session(['win_bash', 'pwsh'])
    recorded.sessions.push({ agent, state })
    // Then there is no listener registered to receive that event, so the later
    // session keeps the surface it was composed with.
    expect(recorded.listeners).toEqual([])
    expect(recorded.effects).toBe(0)
    expect(state.restrictions).toEqual([])
    expect(state.names).toEqual(['win_bash', 'pwsh'])
  })
})

describe('the replacement follows the win_bash registration', () => {
  const registrationIt = isWindowsX64 ? it : it.skip

  /**
   * A context that records the registrations one mount produces, carrying a
   * full-access session so the replacement has somewhere to act.
   * @returns the context, the registered names, and the session's state.
   */
  function mountContext() {
    const { agent, state } = session(['win_bash', 'pwsh'])
    const { ctx } = hostContext([{ agent, state }])
    const registered: string[] = []
    const context = {
      ...(ctx as unknown as Record<string, unknown>),
      tools: { register: (tool: { name: string }) => { registered.push(tool.name); return () => {} } },
      subprocess: { spawn: () => { throw new Error('this host must never reach a spawn') } },
    } as unknown as Context
    return { context, registered, state }
  }

  registrationIt('operator whose win_bash registers gets the host pwsh tool withdrawn in the same mount', () => {
    // Given a Windows deployment that serves a full-access session,
    const { context, registered, state } = mountContext()
    if ('code' in runtime) throw new Error('this host cannot serve the vendored payload')
    // When the entry registers the tool,
    registerWinBash(context, resolveConfig(undefined), runtime)
    // Then win_bash is on the wire and pwsh is not: the ladder's top rung is
    // the only shell the session is offered.
    expect(registered).toEqual(['win_bash'])
    expect(state.restrictions).toEqual([['pwsh']])
    expect(state.names).toEqual(['win_bash'])
  })

  registrationIt('operator turning replacement off gets both shells side by side', () => {
    // Given a deployment that opts out of replacement,
    const { context, registered, state } = mountContext()
    if ('code' in runtime) throw new Error('this host cannot serve the vendored payload')
    // When the entry registers the tool,
    registerWinBash(context, resolveConfig({ replacePwsh: false }), runtime)
    // Then win_bash registers and pwsh stays exactly where it was.
    expect(registered).toEqual(['win_bash'])
    expect(state.restrictions).toEqual([])
    expect(state.names).toEqual(['win_bash', 'pwsh'])
  })
})

describe('the shipped description states the shell preference', () => {
  it('operator reading the catalog-truncated description sees the preference inside 200 characters', () => {
    // Given the tool description a preset catalog truncates at 200 characters,
    const description = CONFIG_DEFAULTS.description
    const visible = description.slice(0, 200)
    // When that visible window is read,
    // Then it names this tool as the one for command work and points at pwsh
    // as the narrower tool, without depending on a sentence the cut removes.
    expect(visible).toContain('pinned bash shell')
    expect(visible).toContain('prefer it over pwsh')
    // And the full text still carries the persistence guarantee it shipped with.
    expect(description).toContain('persist across win_bash calls')
    expect(description).toContain('real exit code')
    // And the background usage is stated in the same description, so a model
    // that needs a job knows the parameter exists without a schema read.
    expect(description).toContain('run_in_background')
    expect(description).toContain('job_output')
    expect(description).toContain('job_kill')
    expect(/^[\x20-\x7e]+$/u.test(description)).toBe(true)
  })
})
