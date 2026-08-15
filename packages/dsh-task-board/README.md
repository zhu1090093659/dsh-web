# dsh-task-board — DSH web GUI task board plugin

English | [中文](README.zh.md)

A hot-pluggable DeepSeek Harness (DSH) client GUI plugin: it adds a **task board** entry below "新会话" (New session) in the sidebar; clicking it switches the middle column entirely to a multi-column kanban view. Tasks execute for **real** through DSH's own session mechanism (`session.prompt`), and execution status is written back to the card in real time.

- No DSH source modification: mounted as a cordis plugin + browser DOM extension (add-on shape identical to `dsh-web-ui/packages/skins/skin-center`).
- Unmounting restores the original state; other managed segments (dsh-skin / skin-center / personal config) are unaffected.
- Task data persists locally; it survives a page refresh and a DSH restart.

## Features

- **Sidebar entry**: injects a "任务看板" (task board) entry row inside the sidebar column (`[data-pane="sidebar"]` on older shells, `[class*="sidebarCol"]` on the DSH 0.1.0-rc.6 AppFrame layout) below the new-session button (wide rail shows icon + text, collapsed rail shows a bare icon, adapting to DSH skin tokens).
- **Multi-column board**: five columns — 待规划 (to plan) / 待办 (to do) / 进行中 (in progress) / 已完成 (done) / 已失败 (failed); cards show title, description, status, update time, and execution count; the top supports search filter, new task, and back to chat.
- **Task details**: click a card to open details (title/description/execution prompt/execution log) — it does **not** execute on a single click; the details offer "执行 / 重新执行" (Run / Re-run), "删除" (Delete, with confirm), "查看会话" (View session, jumps to the execution transcript), and a manual move to 待规划/待办.
- **Real execution**: on "执行" (Run), the plugin connects a workspace session through the client runtime (`workspaces.connectWorkspace`, reusing a blank session or letting the host create one), names the session after the task title, and drives a real agent via `session.prompt([{ type: 'text', text }], 'queue')`; it then subscribes to that session's snapshot and, once the round really finishes, sets the card to 已完成/已失败 and records the execution result. The execution session appears in the session list and can be opened to view the real transcript.
- **Per-task execution targets**: a task can pin where and how it runs — **workspace** (the execution session lands in that workspace), **mode** (the agent preset the session is composed from, switched through `agentPresets.select` while the session is still blank), and **permission** (a sandbox preset applied through the `/permission <id>` slash command: read-only / workspace-write / danger-full-access). Blank pins fall back to the runtime defaults (recent workspace / deployment preset / session default). A pin that cannot be applied fails the run **before** the prompt is sent, so a task never silently runs under settings it did not ask for.
- **Status write-back**: card status (进行中 → 完成/失败) is driven by the real session state; after a page refresh/restart, leftover running tasks are auto-reconciled against the current session state (reconcile).
- **Scheduled tasks**: the details panel can schedule a task — an enable switch + a 5-field cron expression (分 时 日 月 周, supporting `*` / `*/n` / `a-b` / comma lists) + common presets (daily 09:00, every hour, every 10 minutes, Mondays 09:00); enabling computes and persists the "下次运行时间" (next run time), and the card shows a scheduled marker; at the due time it automatically takes the same real-execution path (as manual run), and the execution session remains linkable.
- **System-prompt injection**: the host half (`src/index.ts`) registers a `plugin:task-board` section (order 200) via `SystemPrompt.section`, declaring this plugin's existence, capabilities, and limits to every agent — it is injected when the plugin is in the composition (after mount + DSH restart) and disappears when removed (after unmount + restart), so an agent needs no external docs to know how to work with this board.

## Directory structure

```
package.json / tsconfig.json / tsdown.config.ts   # standalone repo build
build/tsdown.client.ts + build/web/src/platform.ts # client bundle preset copied from the DSH checkout (kept in sync with the running version)
src/index.ts / src/invariant.ts                    # host half: only injects SystemPrompt section (no other behavior)
src/client/index.ts                                # apply(ctx): wires runtime services + mounts DOM
src/client/sidebar-entry.ts                        # sidebar entry injection (self-healing MutationObserver)
src/client/board-mount.tsx                         # middle-column board mount + show/hide toggle
src/client/board/*.tsx                             # React board views (columns/cards/details/new/confirm)
src/client/board.module.css                        # styles (--dsw-* tokens, adapting to theme/skin)
src/core/tasks.ts                                  # task model + state machine (pure functions)
src/core/schedule.ts                               # cron parsing + next-run time (pure functions)
src/core/scheduler.ts                              # browser scheduler (ticks every minute to fire due tasks)
src/core/store.ts                                  # persistence (TaskStore interface + localStorage impl)
src/core/execution.ts                              # real execution service (session connect/prompt/settlement watch)
src/core/controller.ts                             # controller (ledger state, view state, navigation awareness)
tests/*.spec.ts                                    # automated tests: storage/state transitions/execution trigger/cron/scheduling
scripts/dsh-task-board.js                          # one-click mount/unmount/status CLI
```

## Why it is wired this way (research conclusions)

- **No usable add-on slot in the sidebar**: the sidebar shell only declares two single slots, `sidebar.workspaces` / `sidebar.settings`, both already taken by ui-workspace / ui-settings; an external plugin cannot register a new slot (declaring means claiming, and duplicating throws). So the entry goes through the skin-precedent **DOM injection**, self-healed with a MutationObserver (when a React re-render touches the node it re-inserts within the same frame, no flicker).
- **The middle column cannot be replaced through a slot**: the `conversation` slot is single and already taken by ui-conversation. The board view mounts on the center column (`[data-pane="conversation"]` on older shells, `[class*="centerCol"]` on the DSH 0.1.0-rc.6 AppFrame layout) as a tail child node (outside React's ownership), toggled via the `<html data-dsh-taskboard-active>` attribute, keeping the chat subtree below mounted and stateful.
- **Persistence uses browser localStorage**: client plugins run in the browser and DSH has no browser-writable file channel (matching skin-center's research on `cordis.patch.yml`); localStorage is also how DSH's own client snapshot store (`createSnapshotStore` persist) persists.
- **Execution rides the client runtime**: `ctx.sessions.list` subscribes to session state (`running` / `byId`), `ctx.workspaces.connectWorkspace()` creates/reuses a session, `session.prompt()` drives a real agent, and `ctx.sessions.open()` jumps to the transcript.
- **Execution targets ride the same runtime faces**: the workspace pin passes the task's id to `workspaces.connectWorkspace()` (validated against the workspace list first, so a stale pin fails locally); the mode pin recomposes the blank execution session via `api.agentPresets.select` — only legal before the first turn, so it runs before `session.prompt`, and `sessions.noteAgentPreset` keeps the list label current; the permission pin admits a `/permission <id>` slash command through `session.command` — the same mechanism the shell's own permission picker uses. A rejected admission or a line no command claims fails the run before the prompt.
- **Background settlement relies on list reconciliation**: an unopened session has no chat-snapshot window (cold), so settlement keys off the session list — every list change reconciles running tasks; result judgment takes, in order, "missing from list → cancelled / still running → wait / chat snapshot visible → by lastAgentError / tail of raw history → a turn-error node proves failure / otherwise success", and reconciliation is idempotent.
- **Scheduled tasks run in the browser scheduler**: the plugin is pure-client (no server channel), so "run at the due time" is done by the in-tab scheduler — a tick every minute, with an immediate catch-up tick when the page returns from the background; before firing it first moves "next run" forward to the next cron match so the same tick never fires twice; it does not fire early in page load (before the session-list baseline is ready), avoiding mis-execution. Limitation: the tab must stay open (schedules missed while closed are "miss = skip", and only already-deferred due tasks are caught up on the next open); a task that is 进行中 (in progress) skips the current due time and waits for the next cron match.
- **Same-origin tabs share one ledger**: additions, edits, and deletions in any tab propagate to the others through storage events (`LocalStorageTaskStore.subscribeExternal`), so a task deleted in one tab can never keep firing from another tab's stale in-memory copy — nor be written back by that copy's later persistence (schedule roll-forward, execution settlement).

## Install

Install the family aggregate package `@linxin666/dsh-web-ui-all` (all plugins and skins in one) or this plugin alone:

```sh
### 从 npm 安装（推荐）
dsh plugin --profile web add @linxin666/dsh-client-ui-task-board

### 从仓库安装（开发调试）
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-task-board

```

After installing, **restart `dsh web`** — a "任务看板" (task board) entry appears below "新会话" (New session) in the sidebar; a page refresh is not enough, the process must restart.

## Build

Prerequisites: Node ≥ 20 with the official NPM SDK reachable (configure the `NPM_TOKEN` env var + project `.npmrc` if still using private-scope auth; see the repo `docs/plugins.md`). Types and runtime APIs all come from the official NPM SDK (`@deepseek-ai/*` devDependencies); **no DSH source checkout is required**.

```sh
cd ~/code/dsh-web-ui/packages/dsh-task-board
pnpm install        # first time (run pnpm install at the workspace root)
pnpm run build      # produces lib/index.js + lib/client.js (tsdown + shared/tsdown.client.ts preset)
pnpm run typecheck  # type check (SDK package types from node_modules)
pnpm test           # vitest: storage read/write / state transitions / execution trigger
```

## Mount / Unmount

This plugin uses the official profile-bundle shape (package.json declares `dsh.bundle.patch` + `dsh.client`, see `cordis.patch.yml`). Mounting = registering the dependency and bundle rows in the web profile manifest (`~/.dsh/profiles/web/package.json`) and installing:

```sh
# Mount (registers dependencies + dsh.profile.bundles, pnpm install; takes effect after restarting the GUI)
node scripts/dsh-task-board.js mount

# View status
node scripts/dsh-task-board.js status

# Unmount (removes the registered rows; restores the original GUI after restart; task data is kept)
node scripts/dsh-task-board.js unmount
```

The rows registered in the profile manifest:

```json
{
  "dependencies": { "@linxin666/dsh-client-ui-task-board": "link:/Users/zcl/code/dsh-web-ui/packages/dsh-task-board" },
  "dsh": { "profile": { "bundles": [ "...", "@linxin666/dsh-client-ui-task-board" ] } }
}
```

> Note: the profile layer (bundle rows, `dsh.client` metadata) is read when the dsh web process starts, so a **restart of the dsh web GUI** is required after mount/unmount (a page refresh is not enough).

## Data storage location

- The task ledger lives in browser localStorage under the key `dsh.taskBoard.v1` (origin `http://127.0.0.1:<dsh web port>`; same origin persists across refresh/restart).
- Data is retained after unmount; to clear it, run `localStorage.removeItem("dsh.taskBoard.v1")` in the browser console.
- The storage layer is the `TaskStore` interface (`src/core/store.ts`); it can later be swapped for IndexedDB or a host file channel without touching the upper logic.

## Manual verification steps

1. `npm run build` → `node scripts/dsh-task-board.js mount` → refresh `http://127.0.0.1:3080`.
2. A "任务看板" (task board) entry row appears below "新会话" in the sidebar; click it → the middle column switches to the five-column board.
3. "+ 新建任务" (New task) with title/description/Prompt → the card appears in 待办 (to do). The dialog also offers 工作区/模式/权限 (workspace / mode / permission) pins — leave them blank for runtime defaults.
4. Pin a workspace/mode/permission on a task (in the dialog or the task detail) → run it → the execution session appears under the pinned workspace, its list row shows the pinned preset, and the session's permission selector shows the pinned permission.
5. Click the card → details show content and Prompt; click "执行" (Run) → the card becomes 进行中 (in progress) (a session named after the task title appears in the session list); after the agent finishes the card lands in 已完成 (done) or 已失败 (failed), the detail execution log has a result and time, and "查看会话" (View session) jumps to the real transcript.
6. Scheduled task: details → tick "定时运行" (Scheduled run) to enable, pick the preset "每 10 分钟" (every 10 minutes, cron `*/10 * * * *`); a scheduled marker appears on the card; wait for the next whole 10-minute mark, watch the card automatically enter 进行中 (in progress) and eventually complete, with "上次触发" (last trigger) showing a time and a new execution-log row (the session is linkable).
7. Refresh the page / restart DSH → tasks remain; unmount the plugin → the GUI restores to its original state.

## Acceptance checklist

- After mount, a "任务看板" (task board) entry appears in the sidebar; clicking toggles the board, and clicking a session item returns to the chat view
- New task (title + description/Prompt); tasks remain after refresh/restart (localStorage persistence)
- Click a card to open details (content + execution log); the details have "执行" (Run) and "删除" (Delete) buttons
- Execution really starts a session (its transcript is visible in the session list); card status follows the real execution progress; the details can jump to the execution session
- Delete has a confirm step, and the local store is synced-removed after deletion
- Scheduled tasks: cron config/preset/validation, next-run time, auto real execution at the due time, status write-back, scheduled card marker, scheduling resumes after refresh (browser-side scheduling, the tab must stay open)
- Per-task execution targets: workspace/mode/permission pins persist across refresh, drive the execution session, and an un-appliable pin (missing workspace, locked preset, unknown permission command) fails the run with the reason visible in the execution log
- One-click mount/unmount; after unmount the GUI restores and other managed segments are unaffected
- README + automated tests covering storage read/write, state transitions, execution trigger, cron parsing, and the scheduler
