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

import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dshHome } from './dsh-home.ts'

/** How a restart request is carried out. */
export type RestartMode = 'shell' | 'relaunch' | 'manual'

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
}

/** Grace period between answering the restart request and leaving the process. */
export const RESTART_EXIT_DELAY_MS = 400

/** How long the helper waits for this process to disappear before giving up on the wait. */
export const RESTART_WAIT_MS = 30_000

/** Exit/interpreter arguments a relaunch must not repeat (they re-bind fixed ports). */
function isReusableExecArg(argument: string): boolean {
  return !/^--(?:inspect|inspect-brk|inspect-port|debug|debug-brk)(?:=|$)/.test(argument)
}

/**
 * Decide how a restart request is carried out.
 * @param facts - the running process's launch facts.
 * @returns the planned mode, with the relaunch command when one is used.
 */
export function planRestart(facts: RestartFacts): RestartPlan {
  // The Desktop shell owns this process tree: it is the only party that can
  // relaunch the application, and it already offers that action when the host
  // stops. ELECTRON_RUN_AS_NODE is the second, launcher-independent signal for
  // a host started by an Electron shell (the packaged Desktop sets it; a
  // command-line launch never does).
  if (facts.desktop === true || facts.env.ELECTRON_RUN_AS_NODE === '1') return { mode: 'shell' }
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
      try {
        appendFileSync(logPath, new Date().toISOString() + ' helper spawn error: ' + error.message + '\n')
      } catch {
        // A missing log is not worth failing the restart over.
      }
    })
    return helper.pid !== undefined
  } catch (error) {
    try {
      appendFileSync(logPath, `${new Date().toISOString()} helper failed: ${String(error)}\n`)
    } catch {
      // A missing log is not worth failing the restart over; the caller reports 'manual'.
    }
    return false
  }
}

/** Effect seams for {@link performRestart} (tests replace them). */
export interface RestartRuntime {
  /** Start the relaunch helper; false means no replacement was created. */
  startHelper?: (command: RelaunchCommand) => boolean
  /** Leave this process. */
  exit?: () => void
  /** Schedule the exit (delay seam). */
  schedule?: (run: () => void, delayMs: number) => void
}

/**
 * Carry out one restart plan.
 * @param plan - the verdict from {@link planRestart}.
 * @param runtime - effect seams; the defaults spawn the helper and exit.
 * @returns the mode actually used: 'relaunch' degrades to 'manual' when the
 * helper could not be started, so a process that cannot be replaced stays up.
 */
export function performRestart(plan: RestartPlan, runtime: RestartRuntime = {}): RestartMode {
  if (plan.mode === 'manual') return 'manual'
  const startHelper = runtime.startHelper ?? ((command: RelaunchCommand) => startRelaunchHelper(command))
  const schedule = runtime.schedule ?? ((run: () => void, delayMs: number) => { setTimeout(run, delayMs) })
  const exit = runtime.exit ?? (() => { process.exit(0) })
  if (plan.mode === 'relaunch') {
    if (plan.command === undefined || !startHelper(plan.command)) return 'manual'
  }
  // The response must reach the browser before this process disappears.
  schedule(exit, RESTART_EXIT_DELAY_MS)
  return plan.mode
}
