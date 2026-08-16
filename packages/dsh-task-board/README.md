# dsh-task-board — DSH web GUI task board plugin

English | [中文](README.zh.md)

A hot-pluggable DeepSeek Harness (DSH) Web GUI plugin with a Host-authoritative task ledger, real DSH session execution, Host cron scheduling, and optional cross-platform idle-sleep protection. It is mounted through `cordis.patch.yml` and the profile mechanism and does not modify DSH source code.

- The browser is an asynchronous view; closing the page does not stop Host scheduling or execution settlement.
- Every run creates a separate DSH session and applies pinned workspace, agent preset, and permission before sending the task prompt.
- The display may turn off while optional power protection keeps the computer from entering idle system sleep.

## Features

- **Task board UI**: a sidebar entry below New Session shows icon and text in the wide sidebar and an icon in the collapsed rail; the board provides five kanban columns, search, task details, archive/restore, execution history, and links to execution transcripts.
- **Host-authoritative ledger**: tasks, schedules, and execution records live in `$DSH_HOME/task-board/ledger-v2.json`; browser actions become confirmed Host transactions.
- **Real execution**: manual and scheduled runs use the same Host runner, create a fresh session, rename it, apply the agent preset and `/permission <id>`, then queue the task prompt.
- **Fail-closed pins**: a missing workspace, missing or broken preset, or rejected permission command fails before the task prompt is sent.
- **Host scheduler**: 5-field cron supports `*`, `*/n`, ranges, comma lists, Sunday `0/7`, and standard day-of-month/day-of-week OR semantics in the Host local time zone.
- **Deterministic recovery**: a running execution with a recorded session is observed after restart; an interrupted start without a session id is cancelled and is not resent.
- **Live synchronization**: mutations return a full revisioned snapshot; SSE announces revision, scheduler, and power changes, while reconnect and page visibility recovery fetch a full snapshot.
- **Optional idle-sleep protection**: off by default; when enabled it covers every running DSH session, enabled task-board schedules, and unknown session state.

## Architecture and protocol

- `src/index.ts` mounts the Host service through the official `@deepseek-ai/dsh-host-apiproxy` and `@deepseek-ai/dsh-host-webserver` SDKs.
- `src/host-ledger.ts` serializes actions and persists `{ schemaVersion: 2, revision, tasks, scheduler }` through a temporary file plus atomic rename.
- `src/host-service.ts` owns cron ticks, missed-trigger skipping, runner launch, restart reconciliation, and power reasons.
- `src/client/host-api.ts` imports legacy browser data once, submits idempotent actions, and treats Host snapshots as the only confirmed UI state.
- Same-origin endpoints are `GET /api/task-board/state`, `GET /api/task-board/events`, and `POST /api/task-board/action`.
- POST requests require JSON and exact same-origin; a request without `Origin` is allowed only from loopback. Ordinary actions are limited to 64 KiB and import to 2 MiB. The strict action union has no command, executable path, shell text, or arbitrary argument field.

## Install

Install the aggregate package or this package alone, then restart `dsh web`:

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-task-board
```

For local development:

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install
pnpm build
dsh plugin --profile web add link:$(pwd)/packages/dsh-task-board
```

## Configuration

| Key | Default | Behavior |
| --- | --- | --- |
| `enabled` | `true` | Enables the Host service and browser board. |
| `announceToAgent` | `true` | Adds the task-board guidance section to agent system prompts. |
| `preventIdleSleep` | `false` | Holds one system idle-sleep assertion while any DSH session runs, any schedule is enabled, or session state is unknown. |

On macOS the backend starts `/usr/bin/caffeinate -i -w <host-pid>` and never requests `-d`. On Windows it starts the absolute Windows PowerShell under `SystemRoot` with a fixed helper that requests only `ES_CONTINUOUS | ES_SYSTEM_REQUIRED`; it never requests `ES_DISPLAY_REQUIRED`, changes a power plan, or requires administrator privileges. Linux and other platforms report `unsupported` and do not start a fallback command.

## Data storage and migration

- The v2 ledger is `$DSH_HOME/task-board/ledger-v2.json`. New POSIX files use mode `0600`; Windows inherits the user directory ACL.
- A corrupt v2 file is moved to `ledger-v2.json.corrupt-<timestamp>` and the Host starts with an empty ledger plus a visible scheduler error. The corrupt bytes are not overwritten.
- On the first upgraded page load for an origin, `dsh.taskBoard.v1` is imported by stable source and request ids. Tasks merge by id, newer top-level fields win, and execution records merge by execution id.
- The import marker `dsh.taskBoard.v2.hostImported` is written only after Host confirmation. The v1 localStorage value remains untouched as a read-only rollback copy.

## Security model

- The plugin stays inside the existing DSH Web deployment and network boundary and emits no permissive CORS headers.
- All mutation payloads use a strict, versioned discriminated union; schedule-owned timestamps and execution outcomes cannot be written by the browser.
- Workspace, preset, permission, cron, task status, and imported records are validated again on the Host.
- A task prompt is data sent to a DSH agent session. The protocol does not accept shell commands, PowerShell bodies, executable paths, or configurable helper arguments.
- Power helpers use fixed executable paths, fixed arguments, `shell: false`, and bounded retry delays of 1, 2, 5, 10, then 30 seconds.

## Build and test

Node 20 or newer and the official NPM SDK packages are required; no DSH source checkout is used.

```sh
pnpm --filter @linxin666/dsh-client-ui-task-board typecheck
pnpm --filter @linxin666/dsh-client-ui-task-board test
pnpm --filter @linxin666/dsh-client-ui-task-board build
```

The repository CI also runs an opt-in native helper smoke test on `windows-latest` and `macos-latest`; it starts the fixed helper, waits for its ready state, releases it, and confirms process exit without changing the system power plan.

## Manual verification

1. Mount the package, restart `dsh web`, open the task board, and confirm the Host time zone and power status are visible.
2. Create and edit a task; refresh or open a second same-origin tab and confirm both show the same Host revision.
3. Run a task with pinned workspace, preset, and permission; confirm a new session appears and the task settles from its `turn/end` history.
4. Enable a near-future cron, close all browser pages, and confirm the Host still creates and settles exactly one execution.
5. Stop the Host past a cron occurrence, restart it, and confirm the missed occurrence is skipped and `nextRunAt` rolls forward from current Host time.
6. Enable `preventIdleSleep`, run a long session, and let the display turn off; after restoring the display, confirm the session continued and the execution settled.
7. Disable the setting and all schedules, stop DSH, and confirm the helper exits; on macOS, `pmset -g assertions` should show no display-sleep assertion from this plugin.

## Known limitations

- Missed occurrences during Host downtime, system sleep, or a long pause are skipped and never queued for catch-up.
- A task that is already running skips its due occurrence and rolls to the next cron match; task runs never overlap or queue.
- Power protection prevents only idle system sleep. It deliberately allows display sleep and lock.
- Lid close, manual sleep, hibernation, shutdown, low-battery forced sleep, and enterprise power policy are outside the guarantee.
- The plugin does not schedule wake timers and cannot wake a computer that is already asleep.
- Keeping enabled schedules armed may increase battery consumption because protection starts before their future trigger time.
- Host execution consumes the same API quota as an ordinary DSH agent session.
