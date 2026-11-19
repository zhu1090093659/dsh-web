# Agent Note: Task Board SSH provider - cards executed by agents on remote hosts

English | [中文](2026-11-19-task-board-ssh-remote-execution.zh.md)

Status: proposed

This proposal extends the [Task Board external provider extension contract](../../implemented/architecture/2026-09-30-task-board-extension-contract.md) with one optional host member; that note stays the owner of the contract and is updated when the seam ships.

## Problem

The task board runs every card in a local DSH session (`HostExecutionRunner.launch`, `packages/dsh-task-board/src/host-runner.ts`). Four needs are left unserved: the code lives on another machine; the local host should be able to go offline during a long task; several machines should work in parallel; and the agent accounts logged in on the remote machine (dsh, Claude Code, Codex) should be usable.

The two existing providers (`dsh-task-board-github`, `dsh-task-board-team`) bring outside work in and run it locally; nothing sends a local card out. Two seams are missing: the provider contract has no launch member (`packages/dsh-task-board/src/core/extension.ts`), and `dsh-ssh` offers its host list and connection pool to no other plugin (`packages/dsh-ssh/src/index.ts` injects `webServer`, `tools`, `systemPrompt` and provides nothing).

## Proposal

A third provider package, `packages/dsh-task-board-ssh` (npm `@linxin666/dsh-client-ui-task-board-ssh`, row id `ui-task-board-ssh`, extension id `ssh`). Decisions settled with the maintainer:

- **Two execution modes per card.** `direct` (default): the provider starts a headless agent CLI on the remote host and no local session exists. `proxy`: the card runs as an ordinary local session that is told to drive the remote host with the `ssh_*` tools. `proxy` cannot survive the local host going offline and is documented as such.
- **Workspace: two mechanisms covering three user modes.** `in-place` runs in an existing remote directory. `git` runs in a per-run worktree whose source is either a remote-reachable repository URL or the local workspace repository; the result comes back as a branch. A local directory that is not a git repository is not supported.
- **Interaction in direct mode:** replayable log, follow-up messages and rework, by resuming the remote agent session.
- **Permission:** every remote run is fully unattended (each CLI's bypass flag). No per-host ceiling.
- **Scheduling:** a card pins one host; each host has a concurrency cap (default 2) and a FIFO queue.

### Seam 1: `dsh-ssh` host service

`dsh-ssh` provides a cordis service `dshSsh` with `DSH_SSH_API_VERSION = 1`, a thin forwarder over `SshEngine`: `hosts.list()`, `hosts.find(alias)`, `exec(alias, command, { timeoutMs, signal })`, `upload(alias, localPath, remotePath)`, `download(alias, remotePath, localPath)`. No streaming member: log tailing polls by byte offset through `exec`. The face never returns host secrets or the `proxyCommand` text.

### Seam 2: board launch interception

`TaskBoardExtensionHost` gains one optional member under the unchanged `TASK_BOARD_API_VERSION = 1` (the precedent set by `tasks.rework` and `sessions.followUp`): `launch?.intercept(handler)`, returning an unsubscribe function. The runner consults the handlers at the single launch entry, before any session is created, for every trigger (manual run, rerun, schedule, `task_board_run`). `handler(task, { trigger })` is synchronous and returns one of:

- `undefined`: not mine, the board proceeds unchanged.
- `{ kind: 'local', promptPreamble }`: run locally, with the preamble injected ahead of the prompt on the same path as tag prefixes (proxy mode).
- `{ kind: 'external' }`: the board creates no session and no execution record, moves the card to the running column, and the provider later closes it through the existing `record-external-outcome` action.

A throwing handler is isolated and treated as `undefined`. With no handler registered the launch path is byte-for-byte what it is today.

### Remote run protocol (direct mode)

- State lives on the remote host under `~/.dsh/task-board-ssh/`: `runner-<hash>.sh` (a POSIX `sh` launcher installed through `exec`), and `runs/<runId>/{spec.json, prompt.txt, stdout.log, stderr.log, pid, exit, session}`.
- Launcher verbs: `start <runId>`, `status <runId>`, `tail <runId> <offset>`, `cancel <runId>`. `start` is idempotent on `runId`, because the `dsh-ssh` pool may replay a command on reconnect. The agent is detached with `setsid nohup`, so it survives the SSH connection and the local host.
- The provider polls `status` and `tail` on a timer seat (deterministic in tests). On start it reconciles every card that carries an active run: a run that finished while the local host was down is recorded then.
- The ledger payload (`integrations.ssh`) holds the target, the active run and a bounded run history; it never holds log bytes (64 KiB cap). The log is read from the remote file on demand.
- A card moved out of the running column while its run is active is a cancel request; the remote run is cancelled and no outcome is written.

### Agent adapters

Pure functions in `src/core/` map `{ agent, promptFile, cwd, resumeSessionId }` to a command line and parse the output for the session id and the final summary.

| Agent | Start | Resume | Verified |
| --- | --- | --- | --- |
| dsh | `dsh headless --json --permission-mode <preset>` | `--session-id <id>` | flags read from `dsh headless --help`; preset name to verify |
| Claude Code | `claude -p --output-format stream-json --verbose --dangerously-skip-permissions` | `--resume <id>` | flags read from `claude --help` |
| Codex | `codex exec --json` plus its bypass flag | `codex exec resume <id>` | not installed locally; fixture-tested, marked unverified until run on a host that has it |
| custom | user command template with `{prompt_file}`, `{cwd}`, `{session}` | optional | - |

An agent without a working resume degrades follow-up and rework to a fresh run that carries the earlier summary.

### Workspace strategies

One interface, `prepare(run) -> { cwd }` and `collect(run) -> { branch? }`.

- `in-place`: `cwd` is the pinned remote directory; `collect` is a no-op.
- `git` from a URL: a bare cache under `~/.dsh/task-board-ssh/repos/`, a worktree per run on branch `dsh-task/<runId>`; `collect` pushes the branch to that remote when it has commits.
- `git` from the local workspace: `git bundle` of `HEAD` (plus tracked uncommitted changes through `git stash create`), uploaded over `dshSsh.upload`; `collect` bundles the result branch, downloads it and fetches it into the local repository as `dsh-task/<runId>`. Nothing in the local working tree is overwritten. Untracked files are not sent, and the card says so.

### Card surface

Detail section: target form (mode, host, agent, workspace), run state, log viewer, follow-up box, cancel. Card decoration: host and run state (queued, running, lost contact). Settings section inside the board settings card: enable switch, defaults, per-host cap, agent command overrides. Three model-visible tools: `task_board_ssh_target`, `task_board_ssh_status`, `task_board_ssh_follow_up`.

### Delivery slices

1. `dsh-ssh` service; board launch seam; package scaffold with core types, adapters and launcher (parallel).
2. Host run engine; workspace strategies; browser half (parallel, against the core types frozen in slice 1).
3. Aggregate registration, documentation, full gates, end-to-end run against a real sshd.
4. Independent acceptance.

## Context & Efficiency Impact

Direct mode spends no local model tokens. The provider adds three tools and one short prompt section, both released when either switch is off. The ledger grows by one bounded payload per targeted card. `dsh-ssh` and the board each gain one optional surface that costs nothing when unused.

## Alternatives considered

**A peer board on the remote host.** The remote machine would run `dsh web` plus the board and execute a mirrored card. Rejected: it serves dsh only, and the goal includes Claude Code and Codex on machines that carry no DSH install.

**A provider-owned run button with no board seam.** Rejected: the native run button, schedules and `task_board_run` would still start a local session for a card the user pinned to a remote host.

**A new open execution record kind for external runs.** It would put remote runs under the running lock. Rejected for now: it rewrites ledger recovery, which today cancels every open execution that has no session id; the column-only running state plus `record-external-outcome` reaches the same history with no ledger change.

**A streaming exec member on the `dsh-ssh` service.** Rejected: a log that must be replayable after the local host was offline has to be a remote file read by offset anyway.

**`tmux` or `systemd-run` for detaching.** Rejected: neither is guaranteed on a remote host; `setsid nohup` is.

**`git push ssh://` or rsync for the local workspace.** Rejected: system `ssh` does not share `dsh-ssh` credentials (passwords, jump hosts), and rsync has no answer for which side wins on pull-back; bundles travel over the pool and land as a branch.

## Acceptance criteria

- A card pinned to a host in direct mode runs a headless agent there; the native run button, a schedule and `task_board_run` all take that path, and no local session is created.
- Stopping and restarting the local host during a run loses nothing: the log replays from the start and the outcome is recorded once.
- A replayed `start` for the same `runId` starts no second agent.
- A follow-up or rework on a finished card continues the same remote agent session for dsh and Claude Code.
- Runs beyond a host's cap wait in the queue and start in FIFO order.
- The three workspace modes each produce their result: files in place, a pushed branch, a branch fetched into the local repository with the working tree untouched.
- Proxy mode runs a local session whose prompt carries the target preamble.
- With the provider disabled or absent, board and `dsh-ssh` behavior is unchanged, and `grep -rn "ssh" packages/dsh-task-board/src` finds no provider vocabulary.
- Repository gates pass: `pnpm typecheck && pnpm test && pnpm test:standards && pnpm docs:check && pnpm i18n:check`, plus `aggregate:check` and `libs:check`.

## Risks

- **Unattended full permission on remote hosts** is the maintainer's decision; a prompt-injected card can do anything the remote account can.
- **Running-column cards have no running lock**, so a manual move is read as a cancel. A user who drags by mistake stops a remote run.
- **Codex is unverified** until exercised on a host that has it.
- **Remote output returns unredacted** into the card log, the same trust model as `ssh_exec`.
- **The board seam changes the launch path of every card**; the no-handler path must stay byte-for-byte identical and is pinned by a contract test.
