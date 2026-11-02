/**
 * Restart planning and execution for the plugin-manager gateway.
 *
 * The plugin page's restart action exists to make an applied plugin update
 * effective, which means the DSH host process must come back with the new
 * packages loaded. How that is achieved depends entirely on who launched this
 * process, and the host can only tell that from its own facts:
 *
 * - A packaged Desktop launch (the Electron shell's child process, see
 *   isPackagedDesktopArgv / ELECTRON_RUN_AS_NODE) cannot be relaunched by a
 *   plugin: Electron owns the process tree, and anything this process spawns
 *   would fight the shell for the same port while Electron reports the host as
 *   crashed. The plugin therefore stops the host and lets the shell run the
 *   restart it already owns (app.relaunch(), the same recovery action the
 *   Desktop app offers after installing a downloaded update). Mode 'shell'.
 *   That only holds for a shell that ACTUALLY restarts a host that exits. A
 *   shell that merely reports the stop leaves a dead window with no host —
 *   strictly worse than not restarting at all — so the shell must announce the
 *   guarantee in {@link SHELL_RESTART_CAPABILITY_ENV}; a host that sees no such
 *   marker answers 'manual' instead of stopping itself (see
 *   {@link shellRestartIsSupported}).
 * - A host that systemd started is restarted by systemd: the manager owns this
 *   process tree, so asking it to restart the unit is the one action that
 *   survives this process stopping. The host proves that case from its own
 *   cgroup and environment ({@link readSystemdFacts}) and names the unit it
 *   asks; the request goes out after the response, because the stop job starts
 *   the moment the request is queued. Mode 'systemd'. A system unit keeps the
 *   manual answer: restarting it needs privileges this process does not have.
 * - A host this plugin can prove is a terminal launch (an interactive stdio
 *   pair, no Electron in the environment) is restarted in place: a detached
 *   helper waits for this process to exit and re-executes the same command
 *   line, so the port is free before the replacement binds it. Mode 'relaunch'.
 * - Everything else — a supervisor-managed launch with piped stdio, a shell
 *   this plugin cannot identify — is left alone: the route answers 'manual'
 *   and this process keeps running rather than dying with no replacement.
 *   Mode 'manual'.
 *
 * The decision is pure ({@link planRestart}) so the modes are testable without
 * spawning anything; {@link performRestart} is the effectful half.
 * @module @linxin666/dsh-client-ui-plugin-manager/host
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isSystemdUnitName, type RestartMode } from '../core/protocol.ts'
import { dshHome } from './dsh-home.ts'

/** How a restart request is carried out (single source: core/protocol.ts). */
export type { RestartMode }

/** The command line a relaunch re-executes. */
export interface RelaunchCommand {
  /** Absolute path of the executable (Node, or the Electron binary in Node mode). */
  execPath: string
  /** argv after the script path: what `node <argv[0]> <argv[1..]>` ran. */
  argv: string[]
  /** Working directory the replacement starts in. */
  cwd: string
  /** Environment the replacement and its plugin subprocesses inherit. */
  env: NodeJS.ProcessEnv
}

/** One restart verdict. */
export interface RestartPlan {
  mode: RestartMode
  /** Present exactly when mode is 'relaunch'. */
  command?: RelaunchCommand
  /** Present exactly when mode is 'systemd': the unit systemd is asked to restart. */
  unit?: string
}

/** The process facts the verdict is derived from. */
export interface RestartFacts {
  /** Whether the running profile was inferred from the packaged Desktop launcher. */
  desktop?: boolean
  env: NodeJS.ProcessEnv
  execPath: string
  argv: readonly string[]
  execArgv?: readonly string[]
  cwd: string
  /** Whether stdio is a terminal (a launch a human can see and stop). */
  interactive: boolean
  /** The systemd unit this process runs as, when it runs as one. */
  systemd?: SystemdFacts
}

/** The systemd unit this host was started as, when it was started as one. */
export interface SystemdFacts {
  /** Unit name as the cgroup spells it, e.g. `dsh-web.service`. */
  unit: string
  /** Which manager owns the unit: this user's own manager, or the system manager. */
  scope: 'user' | 'system'
}

/**
 * The cgroup path of one `/proc/self/cgroup` line: cgroup v1 writes
 * `<id>:<controllers>:<path>` and v2 writes `0::<path>`. A bare path is
 * returned unchanged, so the pure parser accepts either form.
 * @param line - one cgroup line, or a path already stripped of its fields.
 * @returns the cgroup path.
 */
function cgroupPathOf(line: string): string {
  const cut = line.indexOf(':', line.indexOf(':') + 1)
  return cut === -1 ? line : line.slice(cut + 1)
}

/** The user manager's own unit (`user@1000.service`), the cgroup it runs in. */
const USER_MANAGER_UNIT_RE = /^user@\d+\.service$/

/**
 * Read the systemd-service facts out of a cgroup path and a launch environment,
 * without touching the system.
 *
 * All three markers must hold, and each one is what makes a false positive a
 * real hazard rather than a wrong label:
 * - The cgroup's last segment is the decisive one: only a `*.service` unit of
 *   the conservative shape this package accepts on the wire names a service,
 *   while a scope, a session, or a container path is not a unit. A process this
 *   host starts by hand lands in a scope of its own or shares the host's
 *   cgroup, so this segment is what separates a service from what runs inside
 *   one.
 * - `INVOCATION_ID` rules a launch out but proves nothing on its own: every
 *   process this host starts inherits the host's own marker unchanged, so its
 *   presence is indistinguishable from the host's. It is what rejects a cgroup
 *   path that ends in a service unit only because some other tool put the
 *   process there, which is not a service any manager restarts on request.
 * - The slice says which manager owns it. Only this user's manager is
 *   reachable without privileges, and it is reachable only through its own
 *   socket ({@link readSystemdFacts} checks that; this parser takes the answer).
 *
 * The user manager's own cgroup ends in `user@<uid>.service`. That is a unit
 * name of this shape, and restarting it takes down every service the manager
 * runs, so it is refused rather than read as this host's own unit.
 * @param cgroup - the cgroup path (or a whole `/proc/self/cgroup` line).
 * @param env - the launch environment.
 * @param managerSocket - whether this user's systemd manager socket exists.
 * @returns the unit and its scope, or undefined when this is not a service
 *   this package can ask for a restart.
 */
export function parseSystemdFacts(
  cgroup: string,
  env: NodeJS.ProcessEnv,
  managerSocket: boolean,
): SystemdFacts | undefined {
  const invocation = env.INVOCATION_ID
  if (invocation === undefined || invocation === '') return undefined
  const path = cgroupPathOf(cgroup.trim())
  const scope = path.startsWith('/user.slice/') ? 'user' : path.startsWith('/system.slice/') ? 'system' : undefined
  if (scope === undefined) return undefined
  // The user manager is the only one this process may talk to without
  // privileges, and it answers only while its socket exists.
  if (scope === 'user' && !managerSocket) return undefined
  const unit = path.slice(path.lastIndexOf('/') + 1)
  if (!isSystemdUnitName(unit)) return undefined
  if (USER_MANAGER_UNIT_RE.test(unit)) return undefined
  return { unit, scope }
}

/** Whether this user's systemd manager socket exists (the only way to reach it). */
function userManagerSocketExists(env: NodeJS.ProcessEnv): boolean {
  const runtimeDir = env.XDG_RUNTIME_DIR
  if (runtimeDir === undefined || runtimeDir === '') return false
  return existsSync(join(runtimeDir, 'systemd', 'private'))
}

/**
 * Read this process's own systemd-service facts (Linux only).
 *
 * Every step is a read that fails on another platform, in a container, or
 * under an init that is not systemd, and each failure answers "not a systemd
 * service" instead of throwing: the route that reads this must keep answering
 * 'manual' rather than turning a restart plan into a 500.
 * @param env - the launch environment (INVOCATION_ID, XDG_RUNTIME_DIR).
 * @param cgroupFile - the file carrying this process's cgroup (test seam).
 * @returns the unit and scope, or undefined when this host is not a service.
 */
export function readSystemdFacts(
  env: NodeJS.ProcessEnv = process.env,
  cgroupFile: string = '/proc/self/cgroup',
): SystemdFacts | undefined {
  if (process.platform !== 'linux') return undefined
  try {
    // cgroup v2 writes one line; a v1 hierarchy writes one per controller and
    // each carries its own path, so the first line that yields facts answers.
    const managerSocket = userManagerSocketExists(env)
    for (const line of readFileSync(cgroupFile, 'utf8').split('\n')) {
      if (line.trim() === '') continue
      const facts = parseSystemdFacts(line, env, managerSocket)
      if (facts !== undefined) return facts
    }
    return undefined
  } catch {
    return undefined
  }
}

/** Grace period between answering the restart request and leaving the process. */
export const RESTART_EXIT_DELAY_MS = 400

/**
 * Environment marker a Desktop shell sets when it guarantees that a host which
 * exits is replaced by a fresh host (rather than reported as stopped).
 *
 * The packaged Desktop shell owns the process tree but has no obligation to
 * respawn it: the shipped shell in this repository's compat matrix answers a
 * host exit with `desktop host stopped` and an error page. Stopping ourselves
 * under such a shell turns the restart button into "kill the app", so the mode
 * requires proof of the opposite behaviour.
 */
export const SHELL_RESTART_CAPABILITY_ENV = 'DSH_SHELL_RESTARTS_HOST'

/**
 * Whether the launching shell promises to bring the host back after it exits.
 * @param env - the environment the host was launched with.
 * @returns true only for an opt-in marker value of `1`.
 */
export function shellRestartIsSupported(env: NodeJS.ProcessEnv): boolean {
  return env[SHELL_RESTART_CAPABILITY_ENV] === '1'
}

/** How long the helper waits for this process to disappear before giving up on the wait. */
export const RESTART_WAIT_MS = 30_000

/** Exit/interpreter arguments a relaunch must not repeat (they re-bind fixed ports). */
function isReusableExecArg(argument: string): boolean {
  return !/^--(?:inspect|inspect-brk|inspect-port|debug|debug-brk)(?:=|$)/.test(argument)
}

/**
 * Decide how a restart request is carried out.
 * @param facts - the running process's launch facts.
 * @returns the planned mode, with the relaunch command when one is used and
 *   the systemd unit when systemd performs the restart.
 */
export function planRestart(facts: RestartFacts): RestartPlan {
  // The Desktop shell owns this process tree: it is the only party that can
  // relaunch the application, and it already offers that action when the host
  // stops. ELECTRON_RUN_AS_NODE is the second, launcher-independent signal for
  // a host started by an Electron shell (the packaged Desktop sets it; a
  // command-line launch never does). Owning the tree is not the same as
  // replacing it, though: without the shell's restart guarantee, exiting here
  // leaves the user with a stopped host and an error page, so keep serving.
  if (facts.desktop === true || facts.env.ELECTRON_RUN_AS_NODE === '1') {
    return shellRestartIsSupported(facts.env) ? { mode: 'shell' } : { mode: 'manual' }
  }
  // A systemd service has a manager that owns the process tree and restarts the
  // unit on request, so re-executing in place would fight it. Only the user
  // manager is used: the system manager needs privileges this process does not
  // have, and a request it would refuse is worse than the honest manual answer.
  if (facts.systemd?.scope === 'user') return { mode: 'systemd', unit: facts.systemd.unit }
  // Without a terminal this process was started by something that watches it
  // (a supervisor, an editor task, another app's child process). Re-executing
  // ourselves there would duplicate a server the watcher believes it owns.
  if (!facts.interactive) return { mode: 'manual' }
  // argv[0] is the script the interpreter runs (the dsh CLI entry); without it
  // there is no command line worth re-executing.
  const script = facts.argv[0]
  if (script === undefined || script === '') return { mode: 'manual' }
  return {
    mode: 'relaunch',
    command: {
      execPath: facts.execPath,
      argv: [...(facts.execArgv ?? []).filter(isReusableExecArg), script, ...facts.argv.slice(1)],
      cwd: facts.cwd,
      env: facts.env,
    },
  }
}

/** Absolute path of the relaunch journal this plugin appends to. */
export function restartLogPath(home: string = dshHome()): string {
  return join(home, 'logs', 'plugin-manager-restart.log')
}

/**
 * The detached helper. It is passed as `node -e <source> <job-json>`, so it
 * must stay dependency-free and single-file; the job carries no environment
 * (the child inherits this helper's own).
 */
const RELAUNCH_HELPER = `
const fs = require('node:fs');
const cp = require('node:child_process');
const job = JSON.parse(process.argv[1]);
fs.mkdirSync(job.logDir, { recursive: true });
const log = (line) => { try { fs.appendFileSync(job.logPath, new Date().toISOString() + ' ' + line + '\\n'); } catch {} };
const fd = fs.openSync(job.logPath, 'a');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const launch = (attempt) => {
  if (attempt > 0) log('relaunch attempt ' + (attempt + 1));
  const child = cp.spawn(job.execPath, job.argv, { cwd: job.cwd, env: process.env, detached: true, stdio: ['ignore', fd, fd] });
  child.unref();
  let code = null;
  let spawnError = null;
  child.on('exit', (value) => { code = value; });
  child.on('error', (err) => { spawnError = err; log('relaunch spawn error: ' + err.message); });
  setTimeout(() => {
    if (code === null && spawnError === null) { log('relaunch started (pid ' + child.pid + ')'); fs.closeSync(fd); return; }
    if (attempt < 4) { log('relaunch failed (' + (spawnError === null ? 'exit ' + code : spawnError.message) + '); retrying'); launch(attempt + 1); return; }
    log('relaunch gave up after ' + (spawnError === null ? 'exit ' + code : spawnError.message));
    fs.closeSync(fd);
  }, 3000);
};
const waitFor = (deadline) => {
  if (!alive(job.parentPid) || Date.now() >= deadline) { setTimeout(() => launch(0), 300); return; }
  setTimeout(() => waitFor(deadline), 200);
};
waitFor(Date.now() + job.waitMs);
`

/** The job the helper receives; deliberately small (environment is inherited). */
interface RelaunchJob {
  parentPid: number
  execPath: string
  argv: string[]
  cwd: string
  logDir: string
  logPath: string
  waitMs: number
}

/**
 * Start the detached relaunch helper.
 * @param command - the command line the replacement runs.
 * @param logPath - journal the helper (and the replacement's output) appends to.
 * @returns true when a helper process was actually created.
 */
export function startRelaunchHelper(command: RelaunchCommand, logPath: string = restartLogPath()): boolean {
  const job: RelaunchJob = {
    parentPid: process.pid,
    execPath: command.execPath,
    argv: command.argv,
    cwd: command.cwd,
    logDir: dirname(logPath),
    logPath,
    waitMs: RESTART_WAIT_MS,
  }
  try {
    mkdirSync(dirname(logPath), { recursive: true })
    const helper = spawn(command.execPath, ['-e', RELAUNCH_HELPER, JSON.stringify(job)], {
      cwd: command.cwd,
      env: command.env,
      detached: true,
      stdio: 'ignore',
    })
    helper.unref()
    // A spawn that fails after the call returns is an unhandled `error` event,
    // which is an uncaught exception and would take the dsh host down with it.
    // Journal it instead: the exit this helper was going to replace simply does
    // not happen, and the journal says why.
    helper.on('error', (error: Error) => {
      appendRestartLog(logPath, `helper spawn error: ${error.message}`)
    })
    return helper.pid !== undefined
  } catch (error) {
    // A missing log is not worth failing the restart over; the caller reports
    // 'manual' and the process keeps serving.
    appendRestartLog(logPath, `helper failed: ${String(error)}`)
    return false
  }
}

/** Append one line to the restart journal, ignoring a journal that cannot be written. */
function appendRestartLog(logPath: string, line: string): void {
  try {
    appendFileSync(logPath, new Date().toISOString() + ' ' + line + '\n')
  } catch {
    // A missing log is not worth failing a restart over.
  }
}

/** Effect seams for {@link requestUnitRestart} (tests replace them). */
export interface UnitRestartRuntime {
  /** Start the manager command; the default is node's own `spawn`. */
  spawn?: (executable: string, args: readonly string[], options: SpawnOptions) => ChildProcess
}

/** Node's `spawn` narrowed to the one overload this module uses. */
const spawnDetached = (executable: string, args: readonly string[], options: SpawnOptions): ChildProcess =>
  spawn(executable, args, options)

/**
 * Open the restart journal for appending, creating its directory.
 * @param logPath - journal path.
 * @returns the open descriptor, or undefined when the journal cannot be opened.
 */
function openRestartJournal(logPath: string): number | undefined {
  try {
    mkdirSync(dirname(logPath), { recursive: true })
    return openSync(logPath, 'a')
  } catch {
    return undefined
  }
}

/**
 * Ask this user's systemd manager to restart one unit.
 *
 * `--no-block` returns as soon as the request is queued, so the caller is never
 * held by a stop job it just started and the manager owns the rest. What the
 * command itself says goes to the journal, and so does a deterministic non-zero
 * exit code; a signal death is not, because it is the stop job this request
 * queued (the note beside the exit handler spells that out). From here a
 * refused request looks exactly like a queued one, and the journal is the only
 * place that difference can be read. Nothing is thrown: by the time
 * this runs the route has already answered 202, so an exception here would be
 * an unhandled event in a host nobody is left watching.
 * @param unit - the unit to restart.
 * @param logPath - journal that records what the command said and how it ended.
 * @param runtime - effect seams; the default spawns systemctl detached.
 * @returns true when a systemctl process was actually created.
 */
export function requestUnitRestart(
  unit: string,
  logPath: string = restartLogPath(),
  runtime: UnitRestartRuntime = {},
): boolean {
  const request = `systemctl --user restart ${unit}`
  // The child inherits this descriptor, so its own complaint lands beside the
  // lines written here. This process keeps its copy only across the spawn.
  const journal = openRestartJournal(logPath)
  try {
    const spawnUnit = runtime.spawn ?? spawnDetached
    const child = spawnUnit('systemctl', ['--user', 'restart', '--no-block', unit], {
      detached: true,
      // Both streams go to the journal. An unopenable journal leaves the
      // request itself intact: the restart matters more than the record, and
      // 'ignore' keeps a failed open from turning into a failed spawn.
      stdio: journal === undefined ? 'ignore' : ['ignore', journal, journal],
    })
    // A spawn that fails after this call returns is an unhandled `error` event,
    // which is an uncaught exception and would take the dsh host down with it.
    // Journal it instead: the unit simply keeps running the old host, and the
    // journal says why.
    child.on('error', (error: Error) => {
      appendRestartLog(logPath, `${request} failed: ${error.message}`)
    })
    // A deterministic non-zero exit code is a restart that never happened: the
    // manager refused the unit, or systemctl could not reach it. The command's
    // own stderr is already in the journal; this line records that it finished,
    // and how.
    //
    // A signal death is deliberately not journaled. systemctl runs inside the
    // cgroup of the very unit it is asked to restart, and that unit's default
    // KillMode=control-group makes the stop job this request just queued send
    // SIGTERM to every process in it — systemctl included. Dying that way is
    // the request being carried out, not evidence that it failed, and a line
    // here would record a successful restart as a failure. What systemctl
    // actually objected to still reaches this journal on its own stderr, next
    // to the exit code that settles the question.
    child.on('exit', (code: number | null) => {
      if (code === null || code === 0) return
      appendRestartLog(logPath, `${request} exited with code ${code}`)
    })
    child.unref()
    return child.pid !== undefined
  } catch (error) {
    appendRestartLog(logPath, `${request} failed: ${String(error)}`)
    return false
  } finally {
    if (journal !== undefined) {
      try {
        closeSync(journal)
      } catch {
        // A descriptor this process cannot close takes nothing else with it.
      }
    }
  }
}

/** Effect seams for {@link performRestart} (tests replace them). */
export interface RestartRuntime {
  /** Start the relaunch helper; false means no replacement was created. */
  startHelper?: (command: RelaunchCommand) => boolean
  /** Ask systemd to restart one unit. */
  requestUnit?: (unit: string) => void
  /** Leave this process. */
  exit?: () => void
  /** Schedule the exit (delay seam). */
  schedule?: (run: () => void, delayMs: number) => void
}

/**
 * Carry out one restart plan.
 * @param plan - the verdict from {@link planRestart}.
 * @param runtime - effect seams; the defaults spawn the helper, ask systemd,
 *   and exit.
 * @returns the mode actually used: 'relaunch' degrades to 'manual' when the
 * helper could not be started, so a process that cannot be replaced stays up.
 * A systemd request goes out after the answer and is not awaited, so it keeps
 * the mode it was planned with; a failed request is journaled, not reported.
 */
export function performRestart(plan: RestartPlan, runtime: RestartRuntime = {}): RestartMode {
  if (plan.mode === 'manual') return 'manual'
  const schedule = runtime.schedule ?? ((run: () => void, delayMs: number) => { setTimeout(run, delayMs) })
  if (plan.mode === 'systemd') {
    // A plan that cannot name its unit is not a systemd restart; asking for
    // one anyway would stop nothing and report a restart that never happens.
    const unit = plan.unit
    if (unit === undefined) return 'manual'
    const requestUnit = runtime.requestUnit ?? ((target: string) => { requestUnitRestart(target) })
    // Answer first, request second. systemd's stop job begins the moment the
    // request reaches the manager, so issuing it before the response is written
    // leaves the browser with a dropped connection instead of the 202 — and a
    // restart that looks like a crash is one the user cannot tell from failure.
    schedule(() => { requestUnit(unit) }, RESTART_EXIT_DELAY_MS)
    return 'systemd'
  }
  const startHelper = runtime.startHelper ?? ((command: RelaunchCommand) => startRelaunchHelper(command))
  const exit = runtime.exit ?? (() => { process.exit(0) })
  if (plan.mode === 'relaunch') {
    if (plan.command === undefined || !startHelper(plan.command)) return 'manual'
  }
  // The response must reach the browser before this process disappears.
  schedule(exit, RESTART_EXIT_DELAY_MS)
  return plan.mode
}
