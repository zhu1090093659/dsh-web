/**
 * The only way a workspace strategy talks to a host.
 *
 * Every command is built by `remote-git.ts` (or a helper in `core/shell.ts`) and
 * handed to `dshSsh` verbatim: no strategy opens a connection of its own, so a
 * run shares the host inventory, the credentials and the connection pool the
 * user already operates. A transport failure is raised as the same error type
 * as a command failure, because a workspace that could not be looked at must
 * never be reported as missing.
 *
 * @module dsh-task-board-ssh/host/workspace/remote
 */
import type { DshSshExecResult } from '../../core/contract.ts'
import { shellQuote } from '../../core/shell.ts'
import type { SshWorkspaceRun } from '../../core/workspace.ts'
import { SshWorkspaceError, boundedLine } from './errors.ts'

/** Whether an error is a cancellation, which is not a workspace failure. */
function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * Wrap a failure that never reached the host.
 * @param what - what was being attempted, in one clause.
 * @param error - what the service threw.
 * @returns the workspace failure to raise.
 */
function transportFailure(what: string, error: unknown): SshWorkspaceError {
  const detail = boundedLine(error instanceof Error ? error.message : String(error)) ?? 'unknown failure'
  return new SshWorkspaceError(`${what}: ${detail}`, { cause: error })
}

/** One sentence describing why a remote command did not succeed. */
function describeExecResult(result: DshSshExecResult): string {
  if (result.error !== undefined && result.error !== '') return boundedLine(result.error) ?? 'the connection failed'
  if (result.timedOut) return 'the command timed out'
  const stderr = boundedLine(result.stderr)
  if (stderr !== undefined) return stderr
  return result.exitCode === null ? 'the command exited without a code' : `the command exited with ${result.exitCode}`
}

/**
 * Run one command on the run's host.
 * @param run - the run being served.
 * @param command - command line built from quoted words.
 * @returns what the command did.
 * @throws SshWorkspaceError when the host could not be reached at all.
 */
export async function execRemote(run: SshWorkspaceRun, command: string): Promise<DshSshExecResult> {
  try {
    return await run.ssh.exec(run.host, command, run.signal === undefined ? undefined : { signal: run.signal })
  } catch (error) {
    if (isAbort(error)) throw error
    throw transportFailure(`running a command on ${run.host} failed`, error)
  }
}

/**
 * Run one command and require it to succeed.
 * @param run - the run being served.
 * @param command - command line built from quoted words.
 * @param what - what the command does, for the diagnostic.
 * @returns the finished command.
 * @throws SshWorkspaceError when it failed or the host was unreachable.
 */
export async function execRemoteChecked(
  run: SshWorkspaceRun,
  command: string,
  what: string,
): Promise<DshSshExecResult> {
  const result = await execRemote(run, command)
  if (result.success) return result
  throw new SshWorkspaceError(`${what} failed on ${run.host}: ${describeExecResult(result)}`)
}

/**
 * Run one probe and report whether it held.
 *
 * A probe's non-zero exit is an answer, not a failure: it is how "this
 * directory does not exist" and "this branch is gone" are read without an
 * exception per negative case.
 * @param run - the run being served.
 * @param command - command line that exits zero when the questioned fact holds.
 * @returns whether it held.
 * @throws SshWorkspaceError when the host could not be reached.
 */
export async function probeRemote(run: SshWorkspaceRun, command: string): Promise<boolean> {
  const result = await execRemote(run, command)
  if (result.error !== undefined && result.error !== '') {
    throw new SshWorkspaceError(`cannot reach ${run.host}: ${boundedLine(result.error) ?? 'the connection failed'}`)
  }
  return result.success
}

/**
 * Upload one local file to an absolute remote path.
 * @param run - the run being served.
 * @param localPath - file on this machine.
 * @param remotePath - absolute destination path on the host.
 * @throws SshWorkspaceError when the transfer failed.
 */
export async function uploadToHost(run: SshWorkspaceRun, localPath: string, remotePath: string): Promise<void> {
  try {
    await run.ssh.upload(run.host, localPath, remotePath)
  } catch (error) {
    if (isAbort(error)) throw error
    throw transportFailure(`sending ${localPath} to ${remotePath} on ${run.host} failed`, error)
  }
}

/**
 * Download one remote file to a local path.
 * @param run - the run being served.
 * @param remotePath - file on the host.
 * @param localPath - destination path on this machine.
 * @throws SshWorkspaceError when the transfer failed.
 */
export async function downloadFromHost(run: SshWorkspaceRun, remotePath: string, localPath: string): Promise<void> {
  try {
    await run.ssh.download(run.host, remotePath, localPath)
  } catch (error) {
    if (isAbort(error)) throw error
    throw transportFailure(`bringing ${remotePath} back from ${run.host} failed`, error)
  }
}

/**
 * Remove one remote file, tolerating every failure.
 *
 * Bundles are the only temporary files this package puts on a host, and a
 * leftover one changes no outcome: it is removed on the way past a successful
 * transfer, and a broken connection during that removal must not turn a
 * finished run into a failed one.
 * @param run - the run being served.
 * @param path - absolute remote file path.
 */
export async function removeRemoteFile(run: SshWorkspaceRun, path: string): Promise<void> {
  try {
    await execRemote(run, removeFileCommand(path))
  } catch {
    // Deliberate: see the note above.
  }
}

/**
 * Build the command that removes one remote file, absence included.
 *
 * The only command this package composes outside `core/shell.ts`: that module
 * owns directory removal (`rm -rf`) and nothing else, so a constant verb plus
 * one quoted path is written here rather than there.
 * @param path - absolute remote file path.
 * @returns one shell command.
 */
export function removeFileCommand(path: string): string {
  return `rm -f ${shellQuote(path)}`
}
