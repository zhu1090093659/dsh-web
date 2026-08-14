# dsh-taskboard-agent — Task-board agent bridge plugin for DSH

English | [中文](README.zh.md)

A dual-face (host + browser) plugin for DeepSeek Harness (DSH) that bridges the
agent and the [task-board](https://github.com/zhu1090093659/dsh-web-ui/tree/main/packages/dsh-task-board)
Web GUI. The agent can read, modify and delete kanban cards through four tools;
the board reflects agent changes after a page refresh, and manual GUI edits flow
back to the agent within ~1.5 seconds. Implemented purely on the official
`@deepseek-ai/*` NPM SDK without modifying DSH source.

## Features

| Feature | Description |
| --- | --- |
| Agent tools | `task_board_create` / `task_board_list` / `task_board_update` / `task_board_delete` |
| Bidirectional sync | Browser polls every 1.5s: pushes the board ledger to the host, drains queued mutations and applies them to `localStorage["dsh.taskBoard.v1"]` |
| File persistence | Host mirror persisted to `{DSH_HOME}/dsh-taskboard-agent/board.json`; survives restarts, falls back to in-memory on I/O failure |
| Backward compatible | `GET /pending` keeps the legacy `.tasks` field (create ops) alongside the full `.ops` mutation queue |
| No UI dependency | Browser half is plain fetch/localStorage, no React or client SDK imports |

## Tools

- `task_board_create` — create one kanban card (title required; description / prompt optional).
- `task_board_list` — list cards from the host mirror; optional `status` filter (todo / in_progress / done).
- `task_board_update` — update `status` / `title` / `description` / `prompt` by id (queued, applied on next sync).
- `task_board_delete` — delete a card by id (queued, applied on next sync).

Mutations are asynchronous: the browser applies them within ~1.5s, the board
shows them after a refresh (F5).

## Install

Install from the aggregate family package, or add the package directly:

```sh
dsh plugin --profile web add @linxin666/dsh-taskboard-agent
```

Or from the repo (development):

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-taskboard-agent
```

Restart `dsh web` after install. The four tools become available to agents and
the system prompt announces the bridge.

## Architecture

- Host half (`src/index.ts`): registers the four tools and two routes:
  - `GET /api/dsh-taskboard-agent/pending` — drains the mutation queue (create / update / delete op envelopes).
  - `POST /api/dsh-taskboard-agent/sync` — receives the browser ledger snapshot; replaces the host mirror and persists it.
- Browser half (`src/client.ts`): every 1.5s it pushes the current ledger and
  drains + applies ops (create = append with id dedup, update = merge patch with
  refreshed `updatedAt`, delete = remove by id). The empty ledger is pushed too,
  so the host mirror never serves stale data.
- Persistence: `{DSH_HOME}/dsh-taskboard-agent/board.json` (override via plugin
  config `filePath`); invalid or missing files degrade to an empty in-memory
  mirror.

## Data

- Board data lives in the browser `localStorage["dsh.taskBoard.v1"]` (owned by
  the task-board plugin); this plugin only mirrors it.
- Host mirror: `{DSH_HOME}/dsh-taskboard-agent/board.json`.

## Development

```sh
pnpm --filter @linxin666/dsh-taskboard-agent typecheck
pnpm --filter @linxin666/dsh-taskboard-agent build
```

Behavioral verification is covered by the tests added with this PR: 17
assertions covering tool registration (against the real
`assertSupportedJsonSchema`), the mutation queue, `POST /sync` snapshot
replacement, file persistence, and list / update / delete logic.

## Known limitations

- Mutations are applied on the browser poll (up to ~1.5s latency); a closed
  GUI tab delays application until the next page load of the board.
- The `status` vocabulary is the board's own (todo / in_progress / done);
  other values are stored but not rendered by the board UI.
- The host mirror is only as fresh as the last browser push; changes made
  directly in the board UI appear after the next poll.
