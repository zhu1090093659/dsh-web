/**
 * Host pwsh replacement: while this plugin's win_bash tool actually SERVES a
 * session, the host's own PowerShell tool comes off that session's
 * model-facing surface.
 *
 * WHY. The session then carries two shells, and nothing in either tool's
 * schema says which one to reach for first: a model defaults to the shell it
 * knows, which on Windows is pwsh, so bash-syntax commands keep arriving at a
 * PowerShell that answers them with a syntax error. Hiding pwsh is what makes
 * the preference structural instead of advisory — the ladder is win_bash
 * first, and pwsh stays the fallback for the Windows-native work only it can
 * do.
 *
 * WITHDRAWN ONLY WHERE WIN_BASH CAN SERVE. The precondition is "win_bash can
 * serve this session", never "win_bash is mounted". win_bash runs only in a
 * danger-full-access session (see ./tool.ts and the measured MSYS limitation in
 * the package README): under any restricted mode it refuses every call before a
 * process is started. Taking pwsh away there would leave the session with NO
 * shell at all — win_bash refuses, and the shell that would have run the
 * command is gone - which is precisely the capability loss this module exists
 * to prevent. So a session keeps its pwsh unless its OWN policy reads
 * danger-full-access.
 *
 * AN UNREADABLE POLICY IS NOT A YES. When the deployment composes no sandbox
 * policy service, when the service throws, when it answers with a mode outside
 * the closed vocabulary, or when the agent exposes no session to ask about,
 * this module does NOT withdraw: win_bash refuses to run in exactly those
 * deployments, so the session would lose its only usable shell on the strength
 * of a guess that cannot be verified. The failure direction is deliberate and
 * one-way — a session that keeps a shell it did not need is a preference not
 * yet applied; a session that loses the only shell it had cannot run anything.
 *
 * THE MODE CAN CHANGE MID-SESSION. A permission-preset switch appends one
 * `sandbox/mode` event to that session's log, so "can win_bash serve this
 * session" is not a boot-time fact. The module re-evaluates on the same
 * `internal/dispatch` seam terminal-bash uses for the identical purpose:
 * entering a restricted mode releases the restriction immediately, and
 * returning to danger-full-access withdraws again. The listener is registered
 * with `{ global: true }` because a session's own log event is not dispatched to
 * this plugin's scope, and it re-evaluates synchronously — no poll, no timer,
 * nothing on a boot path.
 *
 * WINDOWS ONLY. The ladder this module encodes is a Windows fact: win_bash is
 * the pinned MSYS2 shell a Windows session gets, and the host shell beside it
 * is PowerShell. POSIX sessions keep exactly the behavior they had — the
 * host's shell there is bash, which is not on the deny list in any case, and
 * this module returns before it reads, listens to, or restricts anything.
 *
 * VISIBILITY ONLY, DELIBERATELY. This module withdraws the tool from the wire
 * and from the generated SDK; it installs no execution guard and no
 * pre-execute denial. A model that has a reason to call pwsh anyway — a
 * Windows-native cmdlet, or a fallback after win_bash failed - must still
 * reach it, which is the ladder's lower rung. A hard refusal here would trade
 * a preference for a capability loss.
 *
 * SCOPED, NEVER GLOBAL. The restriction is installed through each agent's own
 * scoped tools view (`agent.ctx.tools.restrict`), so it covers exactly the
 * sessions win_bash serves and nothing else in the process. A deployment that
 * mounts no win_bash (a refused gate, a missing payload, a non-Windows host,
 * or `replacePwsh: false`) never calls this module at all.
 *
 * TIMING. The host's pwsh is registered by the host's own composition, whose
 * group can settle after this plugin mounts, so a name that is not on the
 * readable surface yet is not a verdict: the registry's own `tools/change`
 * event retries every agent this module watches. Nothing here waits, polls, or
 * holds a boot path open.
 *
 * LIFECYCLE. Every restriction is remembered per agent scope and lifted when
 * that agent is disposed or when this plugin unloads, one isolated callback at
 * a time: a throwing lift must not leave the remaining sessions with a shell
 * they cannot see, and it must not leave the map holding a dead scope.
 * @module @linxin666/dsh-win-bash/pwsh-replacement
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'

/** The host tool this module withdraws while win_bash serves a session. */
export const HOST_PWSH_TOOL = 'pwsh'

/** The one session mode win_bash can actually serve; every other mode refuses. */
export const SERVING_MODE: SandboxMode = 'danger-full-access'

/** Every mode the policy service may answer with. */
const SANDBOX_MODES: ReadonlySet<SandboxMode> = new Set(['read-only', 'workspace-write', 'danger-full-access'])

/** The scoped restriction call this module consumes from an agent's tools view. */
export interface ScopedRestrictor {
  /**
   * Mask global tool names for the calling agent scope.
   * @param filter - the mask; only deny is used here.
   * @returns the exact disposer that lifts the restriction.
   */
  restrict(filter: { deny: readonly string[] }): () => void
}

/** The policy read this module consumes from the sandbox-policy service. */
export interface SessionPolicyReader {
  /**
   * Resolve one session's effective execution policy.
   * @param request - the session whose own `sandbox/mode` log outranks the
   * deployment default; omitting it answers for the deployment.
   * @returns the policy whose mode decides whether win_bash can serve it.
   */
  resolve(request?: { session?: unknown, mode?: SandboxMode }): { mode: SandboxMode }
}

/** One agent scope, as much of it as this module reads. */
interface AgentScopeLike {
  /** The agent's own scoped context, when it exposes one. */
  readonly ctx?: { readonly tools?: ScopedRestrictor }
  /** The session this agent owns; its mode decides whether win_bash serves it. */
  readonly session?: unknown
}

/** The registry read this module consumes. */
interface SurfaceReader {
  /** The model-facing surface one scope sees, or the global view when omitted. */
  schemas(agent?: unknown): unknown
}

/** One watched agent scope and the restriction it currently carries. */
interface WatchedScope {
  /** The session this scope belongs to, read once: an agent's session is fixed. */
  readonly session: unknown
  /** The live disposer; present exactly while the restriction is installed. */
  dispose?: () => void
}

/** What one install run reports and where. */
export interface PwshReplacementOptions {
  /**
   * The host platform this run may act on; defaults to `process.platform`.
   * Any value other than `win32` makes the call a total no-op, so no POSIX
   * deployment can acquire a restriction, a listener, or a disposer from this
   * module. Tests pass it explicitly instead of depending on the runner's own
   * platform.
   */
  readonly platform?: string
  /** Tool names to withdraw; defaults to {@link HOST_PWSH_TOOL}. */
  readonly denied?: readonly string[]
  /**
   * One-time warning sink. The default writes through the plugin logger; a
   * caller may replace it so a host with no logger still sees the message.
   */
  readonly warn?: (message: string) => void
  /**
   * The authority that decides whether win_bash can serve a session; defaults
   * to the deployment's `sandboxPolicy` service. Injectable so a host can hand
   * over an equivalent authority, and so a test can pin the decision without
   * composing a service.
   */
  readonly policy?: SessionPolicyReader
}

/** What the policy says about one session, including "cannot be read". */
type ServingVerdict = 'serves' | 'refuses' | 'unknown'

/** The message of a thrown value, whatever it is. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * One optional service, read without letting a refused lookup escape.
 * @param ctx - the plugin context.
 * @param name - the service name.
 * @returns the service, or undefined when it is not resolvable.
 */
function readService(ctx: Context, name: string): unknown {
  try {
    return (ctx as unknown as { get(key: string): unknown }).get(name)
  } catch {
    return undefined
  }
}

/**
 * The policy authority for this install: the injected reader, else the
 * deployment's sandbox-policy service.
 * @param ctx - the plugin context.
 * @param injected - the caller-supplied reader, when any.
 * @returns the reader, or undefined when no usable one exists.
 */
function policyReader(ctx: Context, injected: SessionPolicyReader | undefined): SessionPolicyReader | undefined {
  if (injected !== undefined) return injected
  const service = readService(ctx, 'sandboxPolicy')
  if (service === null || typeof service !== 'object') return undefined
  if (typeof (service as SessionPolicyReader).resolve !== 'function') return undefined
  return service as SessionPolicyReader
}

/**
 * Whether win_bash can serve one session, from that session's own policy.
 *
 * The SESSION goes into the request on purpose: the service ranks a session's
 * own `sandbox/mode` log above the deployment default, so a read without it
 * would answer for the deployment and could withdraw pwsh from a session the
 * user restricted. An absent reader, a missing session, a throwing `resolve` and
 * a mode outside the closed vocabulary all answer 'unknown', which the caller
 * treats exactly like 'refuses' — see the module head for why the failure
 * direction is one-way.
 *
 * THE MODE IS NOT THE ONLY THING WIN_BASH REFUSES ON. `tool.ts` also refuses a
 * session with no working directory, and `SessionHeader.cwd` is OPTIONAL in the
 * SDK, so such a session reads as full access here while it cannot run a single
 * command there. That is the same "no shell" state reached without any mode
 * switch, so it is decided here too rather than left to the mode alone.
 * @param read - the policy authority, when one exists.
 * @param session - the session to ask about.
 * @returns what win_bash would do for this session.
 */
function servingVerdict(read: SessionPolicyReader | undefined, session: unknown): ServingVerdict {
  if (read === undefined || session === undefined) return 'unknown'
  const cwd = (session as { header?: { cwd?: unknown } }).header?.cwd
  if (typeof cwd !== 'string' || cwd === '') return 'refuses'
  try {
    const mode = read.resolve({ session })?.mode
    if (!SANDBOX_MODES.has(mode)) return 'unknown'
    return mode === SERVING_MODE ? 'serves' : 'refuses'
  } catch {
    return 'unknown'
  }
}

/**
 * The tool names one agent scope currently sees.
 * @param ctx - the plugin context.
 * @param agent - the scope to read for.
 * @returns the names, or undefined when no usable projection is readable.
 */
function visibleNames(ctx: Context, agent: unknown): readonly string[] | undefined {
  const service = readService(ctx, 'tools') as SurfaceReader | undefined
  if (service === null || typeof service !== 'object' || typeof service.schemas !== 'function') return undefined
  try {
    const schemas = service.schemas(agent)
    if (!Array.isArray(schemas)) return undefined
    return schemas
      .map(schema => (schema as { name?: unknown } | undefined)?.name)
      .filter((name): name is string => typeof name === 'string' && name !== '')
  } catch {
    return undefined
  }
}

/**
 * Withdraw {@link HOST_PWSH_TOOL} from every session this plugin can serve,
 * and remember how to give it back.
 *
 * Called from the mount path ONLY after win_bash itself registered, so a
 * deployment that ends up without win_bash keeps the host's shell untouched.
 * @param ctx - context carrying tools and the agent registry.
 * @param options - the names to withdraw, the warning sink, and the policy authority.
 */
export function installPwshReplacement(ctx: Context, options: PwshReplacementOptions = {}): void {
  // Checked FIRST, before the roster read, the listeners, and the effect: on a
  // POSIX host this call must leave no trace at all, so an early return above
  // every side effect is the only shape that satisfies it.
  if ((options.platform ?? process.platform) !== 'win32') return

  const denied = [...(options.denied ?? [HOST_PWSH_TOOL])]
  const read = policyReader(ctx, options.policy)
  /** Agent scope -> the session it owns and the live restriction, if any. */
  const watched = new Map<AgentScopeLike, WatchedScope>()
  let warned = false
  const warn = (message: string): void => {
    if (options.warn !== undefined) {
      try {
        options.warn(message)
      } catch {
        // A broken sink must not become a new failure.
      }
      return
    }
    ctx.logger?.warn?.(message)
  }
  const warnOnce = (message: string): void => {
    if (warned) return
    warned = true
    warn(message)
  }

  /**
   * Remember one scope, so a later mode switch can be re-evaluated even while
   * no restriction is installed: the session is the key the `sandbox/mode` event
   * has to be matched against.
   * @param scope - the agent scope to watch.
   * @returns the scope's record.
   */
  const watch = (scope: AgentScopeLike): WatchedScope => {
    const existing = watched.get(scope)
    if (existing !== undefined) return existing
    const record: WatchedScope = { session: scope.session }
    watched.set(scope, record)
    return record
  }

  /**
   * Lift one scope's restriction, isolating the callback: this restores a
   * shell the session should have back, so a throwing disposer must not stop
   * the ones after it. The scope stays watched, because the session it belongs
   * to may still switch back to a mode win_bash can serve.
   * @param scope - the agent scope to release.
   */
  const release = (scope: AgentScopeLike): void => {
    const record = watched.get(scope)
    const dispose = record?.dispose
    if (record !== undefined) record.dispose = undefined
    if (typeof dispose !== 'function') return
    try {
      dispose()
    } catch (error) {
      warn('dsh-win-bash: the host pwsh tool could not be restored for one session ('
        + messageOf(error) + '); pwsh stays hidden there until the next mount.')
    }
  }

  /**
   * Stop watching one scope and lift whatever it carries: the agent is gone,
   * so nothing about it can change again.
   * @param scope - the agent scope to forget.
   */
  const forget = (scope: AgentScopeLike): void => {
    release(scope)
    watched.delete(scope)
  }

  /**
   * Bring one scope to the state its session's policy asks for: withdraw pwsh
   * when win_bash can serve that session, release it otherwise.
   *
   * The visible surface is read before restricting because `restrict()` refuses a
   * name the registry does not know as a global tool — and "not registered yet"
   * is an ordinary boot state here, not a defect, which is why this retries off
   * `tools/change` instead of reporting it.
   * @param scope - the scope to bring up to date.
   */
  const evaluate = (scope: AgentScopeLike): void => {
    if (scope === null || typeof scope !== 'object') return
    const record = watch(scope)
    const verdict = servingVerdict(read, record.session)
    if (verdict === 'unknown') {
      // Not a per-session defect worth repeating: the cause is deployment-wide
      // (no policy service, or one that cannot answer), and the effect is that
      // pwsh stays visible, which an operator may otherwise read as this
      // replacement being broken.
      warnOnce('dsh-win-bash: the sandbox policy of a session could not be resolved, so the host pwsh tool stays'
        + ' visible beside win_bash there (win_bash refuses every call in a session whose mode is unknown).')
    }
    if (verdict !== 'serves') {
      // win_bash refuses this session, so its pwsh is the only shell it has.
      release(scope)
      return
    }
    if (record.dispose !== undefined) return
    const names = denied.filter(name => (visibleNames(ctx, scope) ?? []).includes(name))
    if (names.length === 0) return
    const restrict = scope.ctx?.tools?.restrict
    if (typeof restrict !== 'function') {
      warnOnce('dsh-win-bash: this deployment exposes no scoped tools view, so the host pwsh tool stays visible beside win_bash.')
      return
    }
    // Reserve the slot BEFORE restricting: the registry emits `tools/change` for
    // a restriction change, and a listener that re-entered here with the slot
    // still empty would restrict the same scope again, forever.
    record.dispose = () => {}
    let dispose: unknown
    try {
      dispose = restrict.call(scope.ctx?.tools, { deny: names })
    } catch (error) {
      record.dispose = undefined
      warnOnce('dsh-win-bash: the host pwsh tool could not be withdrawn from this session ('
        + messageOf(error) + '); pwsh stays visible beside win_bash.')
      return
    }
    if (typeof dispose !== 'function') {
      record.dispose = undefined
      warnOnce('dsh-win-bash: the tool registry did not confirm the pwsh restriction, so pwsh stays visible beside win_bash.')
      return
    }
    record.dispose = dispose as () => void
  }

  /**
   * Re-evaluate every scope that owns the session an event came from.
   * @param session - the session whose log changed.
   */
  const reevaluate = (session: unknown): void => {
    for (const [scope, record] of [...watched]) {
      if (record.session !== session) continue
      evaluate(scope)
    }
  }

  // The created listener returns undefined explicitly: the event is declared
  // serial, so its listeners are typed as returning undefined | Promise<undefined>
  // and a bare void arrow is not assignable to that.
  ctx.on('agent/created', ({ agent }) => {
    evaluate(agent as AgentScopeLike)
    return undefined
  })
  ctx.on('agent/disposed', ({ agent }) => { forget(agent as AgentScopeLike) })
  // The host's own shell row may mount after this one. A name that is not on
  // the surface yet is caught here rather than guessed at mount time.
  ctx.on('tools/change', () => {
    for (const scope of [...watched.keys()]) evaluate(scope)
  })
  // A permission-preset switch writes sandbox/mode into the session's own log,
  // and that is not dispatched to this plugin's scope, so this listener must be
  // global to see it. It re-evaluates synchronously and installs no timer: the
  // restriction follows the mode as it is switched, in both directions.
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    if (!Array.isArray(args)) return
    const [session, event] = args as [unknown, { type?: unknown } | undefined]
    if (event?.type !== 'sandbox/mode') return
    reevaluate(session)
  }, { global: true })

  // Sessions that were already running when this plugin mounted.
  const registry = readService(ctx, 'agents') as { list?: () => unknown[] } | undefined
  if (registry !== undefined && typeof registry.list === 'function') {
    try {
      for (const agent of registry.list() ?? []) evaluate(agent as AgentScopeLike)
    } catch (error) {
      warnOnce('dsh-win-bash: the session roster could not be read, so the host pwsh tool stays visible in sessions that were already open ('
        + messageOf(error) + ').')
    }
  }

  ctx.effect(() => () => {
    // Snapshot first: forget deletes from the map it is iterating.
    for (const scope of [...watched.keys()]) forget(scope)
  }, 'dsh-win-bash: host pwsh replacement')
}