# @linxin666/dsh-client-ui-task-board-ssh

English | [中文](README.zh.md)

A task-board provider extension that runs a pinned card as a headless agent session on a remote host reached through dsh-ssh, so the work happens on the machine that holds the code and keeps running while this host is away.

## What it does

- Registers the `ssh` provider extension with the task board and takes over the cards pinned to a remote target at the board's single launch gate, so the native run button, a schedule and `task_board_run` all take the same path.
- Starts dsh, Claude Code, Codex or a custom command on the host through one POSIX `sh` launcher, detached with `setsid nohup` (falling back to `nohup` on hosts without `setsid`, such as macOS), so a run outlives the SSH connection and the local host.
- Keeps the run account in the card's own payload and the output in a remote file read back by bounded byte-offset pages, so a log replays from its start at any time.
- Adds model-visible tools (`task_board_ssh` as the one surface, plus the older `task_board_ssh_target`, `task_board_ssh_status`, `task_board_ssh_follow_up` kept as a compatibility layer) and one task-detail seat holding the target form, the run state, the log viewer, the follow-up box and cancel.
- Offers the same target choice in the create dialog's Run Mode section, so a card can be created already pinned to a host. The choice starts as no target at all: such a card is created untargeted and its detail seat sets the target afterwards, exactly as before.
- Cancelling a run from the task-detail seat stops the remote process and puts the card back in the to-do column, with no verdict written.

## Execution modes

- `direct` (default) starts a headless agent on the host over dsh-ssh. The board creates no local session and no local execution record, only the card in the running column, which the provider closes through the board's external-outcome action.
- `proxy` runs the card as an ordinary local session whose prompt opens with the pinned remote target, and that session drives the host through the `ssh_*` tools of dsh-ssh.

Proxy mode cannot survive this host going offline: the session, its tool calls and its token spend all live here, so stopping this host stops the work. Direct mode is the one that keeps going, and on the next start the provider reconciles every run that finished while this host was down.

## Workspaces

- `in-place` runs in an absolute directory that already exists on the host and collects nothing.
- `git` from a repository URL keeps a bare cache per source under `~/.dsh/task-board-ssh/repos/` on the host, adds one worktree per run under `workspaces/<runId>`, commits on the branch `dsh-task/<runId>` and pushes that branch back to the URL.
- `git` from the local workspace sends `HEAD` plus the tracked uncommitted changes as a git bundle, adds the same per-run worktree on the host, and fetches `dsh-task/<runId>` into the local repository without touching its working tree, index or `HEAD`.

Untracked files are not synced: a bundle carries commits, so untracked and ignored files stay on this machine. A local-workspace run counts the untracked non-ignored files it did not receive and reports that count in the run summary the card renders.

## Install

The host half takes the board and dsh-ssh through one cordis dependency scope: while either service is missing it registers nothing, and it unloads the moment either is withdrawn. In the aggregate bundle the `dsh-ssh` row (`web-ui-ssh`) ships disabled by default, so turn it on in the plugin manager first; until then a card's detail seat only says "Enable the SSH plugin in the plugin manager first", and the create dialog shows no SSH rows at all.

### From npm

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-task-board-ssh@latest
```

### From the repository

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install
pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-task-board-ssh
```

## Config

### Per card

A card's target is chosen in the create dialog's Run Mode section, or on its detail seat afterwards. Both surfaces edit these same four fields, and a card created without a target keeps none: nothing is pinned until one of them says where it runs.

- `mode`: `direct` or `proxy`, as described under execution modes.
- `host`: the dsh-ssh host alias the run addresses.
- `agent`: `dsh`, `claude`, `codex` or `custom`; a custom agent needs a start command template carrying `{prompt_file}` and optionally a resume template.
- `workspace`: `in-place` with a remote path, or `git` with a repository URL and an optional base branch, or `git` with the id of a local workspace.

### Agent surface

`task_board_ssh` takes `action: create | bind | read | run | status | log | followup`. One call, `{action:"create", title, prompt, host, workspacePath, run:true, wait:true}`, creates the card with its target, checks it, starts the run and blocks until it settles.

- Target choice: `mode` `direct` starts a headless agent on the host and keeps no local session (self-contained jobs); `proxy` runs a local session that drives the host (work that needs local context). `workspaceKind` `in-place` works inside the existing remote directory `workspacePath`; `git` makes a per-run worktree on branch `dsh-task/<runId>` from `repositoryUrl` or the local `workspaceId`. `agent` is `dsh` (default), `claude`, `codex` or `custom` (needs `agentCommand`).
- Preflight on `create` and `bind` (skip with `preflight:false`), before anything is saved: `host-unreachable` (alias unknown to dsh-ssh or the host did not answer), `agent-missing` (not a supported agent name, or its program is not on the host PATH), `path-missing` (an in-place directory is never created), `permission-required` (the directory is not writable by the ssh user). A refused `create` leaves no card. `run-active` refuses a second run while one is in flight. `invalid-target` lists the other malformed fields.
- Run handle: `task_board_run` and `action:"run"` answer `executionId`, `runId`, `logPath`, `target`, `estimatedDurationMs` (median of earlier successful runs, else 180000) and a note naming the call that blocks. The settled board execution takes that `executionId`.
- `status` has one shape for a running and a settled run: `phase` (never missing), `exitCode`, `result`, `summary`, `error` (`code`, `message`, `retryHint`, failures only), `durationMs`, `remoteSessionId`, `lastActivityAt`, and while running `lastActivity` (the agent's last tool call). `wait:true` with `timeoutMs` (default 120000, at most 600000) blocks until the run settles; a timeout answers `timedOut:true` and the run keeps going.
- `log` filters on the host: `system` events other than `init`, `rate_limit_event` and stream deltas are dropped and lines are cut at 2000 bytes. Reads are `tail` N lines (default 40) or `since` a cursor (`nextSince`), at most 64 KB per reply (`maxBytes` up to 128 KB); `stats` (`rawBytes`, `filteredLines`, `filteredBytes`) comes with every reply and `statsOnly:true` returns it alone; `raw:true` skips the filter.
- A succeeded run's conclusion is the execution `summary`; `error` carries failures, with `errorCode` and `retryHint`. `task_board_get` and `task_board_list` show a `remote` summary (host, agent, mode, `canFollowUp`) for these cards, and never report `permissionPending` for a direct card, which the local permission gate does not govern.

### Extension settings

- `enabled`: the master switch; off withdraws the detail seat, the card badge, the create dialog's row, the four tools and the launch interceptor, and stops polling every run it follows.
- `defaultMode`, `defaultAgent` and `defaultHost`: what a card opens with before anyone pins a target.
- `perHostCap`: how many runs one host executes at once, from 1 to 16, default 2; the rest wait in submission order.
- `agentCommands`: per-agent command templates that replace the built-in command line.

## Security model

- Every remote run is unattended. dsh runs with `--permission-mode danger-full-access`, Claude Code with `--dangerously-skip-permissions` and Codex with `--sandbox danger-full-access`, so a card is an instruction to an agent that never asks this host for approval: a card whose prompt is hostile can do anything the remote account can.
- Every value the provider sends to a host passes through one POSIX shell quoting function; no remote command line is assembled from raw text.
- dsh-ssh hands this package no credential, key path or proxy command, and the card payload holds no log bytes.
- A remote log returns into the card unredacted, the same trust model as `ssh_exec`.

## Known limitations

- Codex is unverified. Its flags and event names come from OpenAI's non-interactive-mode documentation, and the adapter is fixture-tested against that documented stream only; the first run on a host that has Codex must confirm or correct it.
- The launcher needs a POSIX `sh` on the host (using `setsid` when present and falling back to `nohup` otherwise, e.g. on macOS); a host without POSIX `sh` cannot run a direct card.
- A card moved out of the running column while its run is active is read as a cancel request, so a mistaken drag stops the remote run.
- A git workspace needs a repository on one side or the other: a local directory that is not a git repository cannot be sent to a host.
- The run directory under `~/.dsh/task-board-ssh/runs/<runId>/` on the host is the only copy of that run's output; nothing about it is copied into the card.

## License

Apache-2.0.
