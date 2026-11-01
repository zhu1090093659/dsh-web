# Agent Note: A win_bash shell's private temp directory is reclaimed with it

Status: implemented

## Problem

`shellTempDir()` in `packages/dsh-win-bash/src/shell.ts` created one private directory per shell under the machine's temp root — `dsh-win-bash-<pid>-<uuid8>` — and injected it as that shell's `TMPDIR`/`TMP`/`TEMP`, so bash's whole mkstemp family stayed inside one directory instead of the shared temp root. That isolation is right. The teardown was missing: `terminate()` only signalled the process and awaited its exit, `dispose()` and `disposeAll()` only called `terminate()`, the process-exit path inside `run()` only dropped the registry entry, and the package contained no removal call at all (its only fs import was `mkdirSync`). `LiveShell` did not even record the path, so nothing at teardown could have found it.

The result was a directory per shell, forever, including every `exit`-then-rebuild, every timeout, every abort and every `run_in_background` job. Anything a command wrote under TEMP — apktool unpacking, pip/npm installs, tar extracts, installers — stayed in it. Issue [#1993](https://github.com/zhu1090093659/dsh-web/issues/1993) measured 75 such directories, 167,174 files and 5.83 GB on one machine, growing monotonically, with 14 apktool trees whose paths exceeded 260 characters and which `Remove-Item -Recurse` could not delete at all. Each host restart also turned every directory of the previous process into an orphan whose pid no longer existed.

## Decision

`LiveShell` carries the `temp` directory it owns. `ShellRegistry.ensure()` creates it once, hands the same path to `shellEnvironment` and stores it on the record, so teardown never recomputes a name it could get wrong.

`removeShellTempDir(temp)` deletes one directory with `rm({ recursive: true, force: true, maxRetries: 3, retryDelay: 100 })` and swallows every failure. The retries are the Windows half: a child that just exited has not necessarily released its own handles, and rm reports that as `EBUSY`/`EPERM`; a few short retries turn that into a reclaim. Swallowing is the teardown half, matching what `terminate()` already did for the process: a shell whose directory cannot be deleted must not fail the disposal that is already under way.

It is called on all three endings a shell has: `terminate()` after `waitForExit()` (so `dispose()`, `disposeAll()` and the timeout/abort paths all reach it), the `shell.exited` branch of `run()` for a command that ended the shell itself, and the settle handler of a background job (`BackgroundCommand.temp`, removed after the process's own exit, a kill through the job hooks, and a starter that never spawned).

`sweepOrphanShellTempDirs()` is the crash fallback and the only thing that can cover a host killed before it could delete anything. It lists the temp root, takes the pid out of every `dsh-win-bash-<pid>-<uuid8>` directory name, and deletes the ones whose process no longer exists (`process.kill(pid, 0)`, where `EPERM` counts as alive). Directories owned by this process or by any live pid are kept, so a second DSH instance sharing the temp root keeps its shells' directories. Each directory is attempted on its own: one that cannot be deleted is reported and skipped instead of aborting the round. `apply()` runs it once per mount, detached, and logs only when it removed or failed something.

## Alternatives considered

**Delete the directory after every call instead of when the shell ends.** Rejected: the directory is the shell's `TMP`, so its contents belong to the shell's lifetime, not to one command. Deleting it per call would break a command that expects what the previous command left under `$TMP`, and would hand the next command a `TMP` that no longer exists.

**A process-exit hook (`process.on('exit')`) instead of a next-start sweep.** Rejected on two counts: no asynchronous work may run in an `exit` handler, so a recursive delete of a multi-gigabyte tree could not happen there; and the case that needed covering — a crash or a hard kill — never reaches an exit handler at all.

**A persisted "clean up next time" list for directories that could not be deleted.** Rejected: the pid in the directory name already tells the next start exactly what a list would, with no state to write, corrupt or lose. The sweep is the list.

**Age-based reclamation (delete `dsh-win-bash-*` directories older than N hours).** Rejected: a session can legitimately keep one shell alive for much longer than any threshold, so an age rule would delete the `TMP` of a running shell; and it cannot distinguish a live long-running shell from a dead one at all. The pid is an exact owner test.

**Await nothing in `terminate()` and let the sweep do the work.** Rejected: the sweep runs at the next start, so a long-lived host would accumulate every directory of its own session until it restarted — the monotonic growth the issue reports. Deletion has to happen while the process that owns the directory is still running.

## Consequences

- A shell's directory, and everything a command wrote under TEMP, is gone when the shell ends: a normal session no longer grows the temp root.
- Teardown now does file-system work: `dispose()`, `disposeAll()` and the exit path of a call await the delete, bounded by the retry budget. A pathological tree can therefore lengthen a teardown by those retries; failure is contained and the directory is retried by the next start's sweep.
- A directory whose owner pid is alive is never deleted, so instances sharing a temp root do not delete each other's live shells. The cost is that a directory leaked by a live process waits for that process to end.
- The sweep runs on every plugin mount: one `readdir` of the temp root, plus one delete per orphan. It logs a line only when it reclaimed or failed something, so a clean start stays quiet.
- `shellTempDir()` takes an optional base root (defaulting to the machine's `tmpdir()`), which is what lets the tests drive the real file system without touching the machine's own temp root.

## Testing

- `tests/shell-temp.spec.ts` (new) certifies the directory contract against the real file system: a shell's directory exists and is named for the owning pid; removal takes nested content with it and leaves the shared root; a second removal is a no-op; the sweep deletes a directory whose process is gone (a real exited child), keeps one whose process is alive (a real live child) and one named for this process, ignores every other name shape including a `dsh-workspace-changes-*` directory and a non-directory, reports a directory that refuses deletion instead of aborting the round, and reports an unreadable root as empty.
- `tests/shell.spec.ts` adds two cases over the shipped payload: a command that ends the shell with `exit` leaves no directory behind, and disposing a session removes the directory including a file the command wrote under `$TMP`.
- `tests/background.spec.ts` adds two cases: a settled background job removes the directory it was given, and a job whose process could not be spawned removes it too.
- `pnpm --filter @linxin666/dsh-win-bash typecheck`, `test` (147 tests over 12 files) and `build` pass.
