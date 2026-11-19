# Agent Note: Task Board SSH provider - cards executed by agents on remote hosts

English | [中文](2026-11-19-task-board-ssh-remote-execution.zh.md)

Status: implemented

This decision adds one optional host member to the [Task Board external provider extension contract](../architecture/2026-09-30-task-board-extension-contract.md); that note stays the owner of the contract and carries the seam's shape.

## Problem

The task board runs every card in a local DSH session (`HostExecutionRunner.launch`, `packages/dsh-task-board/src/host-runner.ts`). Four needs are left unserved: the code lives on another machine; the local host should be able to go offline during a long task; several machines should work in parallel; and the agent accounts logged in on the remote machine (dsh, Claude Code, Codex) should be usable.

The two existing providers (`dsh-task-board-github`, `dsh-task-board-team`) bring outside work in and run it locally; nothing sends a local card out. Two seams are missing: the provider contract has no launch member (`packages/dsh-task-board/src/core/extension.ts`), and `dsh-ssh` offers its host list and connection pool to no other plugin (`packages/dsh-ssh/src/index.ts` injects `webServer`, `tools`, `systemPrompt` and provides nothing).

## Decision

A third provider package, `packages/dsh-task-board-ssh` (npm `@linxin666/dsh-client-ui-task-board-ssh`, standalone row id `ui-task-board-ssh`, aggregate row id `web-ui-task-board-ssh`, extension id `ssh`). The decisions settled with the maintainer:

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

A throwing handler is isolated and treated as `undefined`. With no handler registered the launch path is byte-for-byte what it is without the seam.

### Remote run protocol (direct mode)

- State lives on the remote host under `~/.dsh/task-board-ssh/`: `runner-<hash>.sh` (a POSIX `sh` launcher installed through `exec`), and `runs/<runId>/{spec.json, prompt.txt, stdout.log, stderr.log, pid, exit, session}`.
- Launcher verbs: `start <runId>`, `status <runId>`, `tail <runId> <offset>`, `cancel <runId>`. `start` is idempotent on `runId`, because the `dsh-ssh` pool may replay a command on reconnect. The agent is detached with `setsid nohup`, so it survives the SSH connection and the local host.
- The provider polls `status` and `tail` on a timer seat (deterministic in tests). On start it reconciles every card that carries an active run: a run that finished while the local host was down is recorded then.
- The ledger payload (`integrations.ssh`) holds the target, the active run and a bounded run history; it never holds log bytes (64 KiB cap). The log is read from the remote file on demand.
- A card moved out of the running column while its run is active is a cancel request; the remote run is cancelled and no outcome is written.

### Agent adapters

Pure functions in `src/core/adapters/` map `{ agent, promptFile, cwd, resumeSessionId }` to a command line and parse the output for the session id and the final summary.

| Agent | Start | Resume | Verification |
| --- | --- | --- | --- |
| dsh | `dsh headless --json --permission-mode danger-full-access` | `--session-id <id>` | Recorded from a real CLI run; the preset name comes from the CLI's own error text |
| Claude Code | `claude -p --output-format stream-json --verbose --dangerously-skip-permissions` | `--resume <id>` | Recorded from a real CLI run |
| Codex | `codex exec --json --sandbox danger-full-access --skip-git-repo-check` | `codex exec resume <id>` | Documented only: no host here installs Codex |
| custom | user command template with `{prompt_file}`, `{cwd}`, `{session}` | optional | - |

The recorded streams and the exact recording commands live in `packages/dsh-task-board-ssh/tests/fixtures/RECORDING.md`. An agent without a working resume degrades follow-up and rework to a fresh run that carries the earlier summary.

### Workspace strategies

One interface, `prepare(run) -> { cwd }` and `collect(run) -> { branch? }`.

- `in-place`: `cwd` is the pinned remote directory; `collect` is a no-op.
- `git` from a URL: a bare cache under `~/.dsh/task-board-ssh/repos/`, a worktree per run on branch `dsh-task/<runId>`; `collect` pushes the branch to that remote when it has commits.
- `git` from the local workspace: `git bundle` of `HEAD` (plus tracked uncommitted changes through `git stash create`), uploaded over `dshSsh.upload`; `collect` bundles the result branch, downloads it and fetches it into the local repository as `dsh-task/<runId>`. Nothing in the local working tree is overwritten. Untracked files are not sent, and the card says how many were left behind: `prepare` counts them and the count reaches the run summary.

### Card surface

Detail section: target form (mode, host, agent, workspace), run state, log viewer, follow-up box, cancel. Card decoration: host and run state (queued, running, lost contact). Settings section inside the board settings card: enable switch, defaults, per-host cap, agent command overrides. Three model-visible tools: `task_board_ssh_target`, `task_board_ssh_status`, `task_board_ssh_follow_up`.

## Context & Efficiency Impact

Direct mode spends no local model tokens. The provider adds three tools and one short prompt section, both released when either switch is off. The ledger grows by one bounded payload per targeted card. `dsh-ssh` and the board each gain one optional surface that costs nothing when unused.

## Alternatives considered

**A peer board on the remote host.** The remote machine would run `dsh web` plus the board and execute a mirrored card. Rejected: it serves dsh only, and the goal includes Claude Code and Codex on machines that carry no DSH install.

**A provider-owned run button with no board seam.** Rejected: the native run button, schedules and `task_board_run` would still start a local session for a card the user pinned to a remote host.

**A new open execution record kind for external runs.** It would put remote runs under the running lock. Rejected for now: it rewrites ledger recovery, which today cancels every open execution that has no session id; the column-only running state plus `record-external-outcome` reaches the same history with no ledger change.

**A streaming exec member on the `dsh-ssh` service.** Rejected: a log that must be replayable after the local host was offline has to be a remote file read by offset anyway.

**`tmux` or `systemd-run` for detaching.** Rejected: neither is guaranteed on a remote host; `setsid nohup` is.

**`git push ssh://` or rsync for the local workspace.** Rejected: system `ssh` does not share `dsh-ssh` credentials (passwords, jump hosts), and rsync has no answer for which side wins on pull-back; bundles travel over the pool and land as a branch.

## Consequences

- The native run button, a schedule, `task_board_run` and a rework all reach the same launch gate, so a card pinned to a host runs there and no local session exists for it.
- Stopping and restarting the local host loses nothing: the log replays from its start and the outcome is recorded once.
- A replayed `start` for the same `runId` starts no second agent.
- A follow-up or a rework on a finished card continues the same remote agent session for dsh and Claude Code; an agent that cannot resume degrades to a fresh run carrying the previous summary.
- Runs beyond a host's cap wait in the queue and start in FIFO order.
- The three workspace modes each produce their result: files in place, a pushed branch, or a branch fetched into the local repository with its working tree untouched.
- Proxy mode runs a local session whose prompt carries the target preamble.
- With the provider disabled or absent, board and `dsh-ssh` behavior is unchanged, and the board's source carries no provider vocabulary: `grep -rn "ssh" packages/dsh-task-board/src` matches one line only, the `ssh` key of the shared prompt-section order table in `src/tool-surface.ts` (a generated copy of `shared/host/tool-surface.ts` that predates this feature), which is that plugin's ordering entry and says nothing about this provider.
- The repository gates that cover it pass: `pnpm typecheck && pnpm test && pnpm test:standards && pnpm docs:check && pnpm i18n:check`, plus `aggregate:check` and `libs:check`.
- **Unattended full permission on remote hosts** is the maintainer's decision, and it is the largest accepted risk: a prompt-injected card can do anything the remote account can.
- **Running-column cards have no running lock**, so a manual move is read as a cancel. A user who drags by mistake stops a remote run.
- **Codex is unverified** until it is exercised on a host that has it.
- **Remote output returns unredacted** into the card log, the same trust model as `ssh_exec`.
- **The board seam changes the launch path of every card**; the no-handler path must stay byte-for-byte identical and is pinned by a contract test.
- **Untracked files stay behind** in a local-workspace run, because a bundle carries commits; the count is published in the run summary rather than guessed silently.
- **A card whose mount is incomplete shows no provider surface at all**: the host half registers nothing until both the board and `dsh-ssh` are there, and `dsh-ssh` ships as a disabled row in the aggregate, so a freshly installed bundle says only "Enable the SSH plugin in the plugin manager first" on a card's detail seat until that row is turned on.
