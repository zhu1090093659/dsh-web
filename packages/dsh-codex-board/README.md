# @linxin666/dsh-client-ui-codex-board

English | [中文](README.zh.md)

A Codex-style floating task board for the DSH Web GUI: a small board pinned to
the top-right that mirrors the current session's task list as maintained by the
agent through the `todo_write` tool. The header shows `completed/total` with a
progress bar, every row carries a three-state marker (pending / in progress /
completed), and clicking the header collapses the board (remembered per
session).

- No DSH source changes: mounted as a cordis plugin via a `document.body`
  global root (the `dsh-pet` precedent); unmounting restores the shell.
- Data comes from the official session projection: the host folds
  `todo/write` events into `session/projection` frames (key `todos`), and the
  browser subscribes through
  `sessions.binding(id).session.projections.faceOf('todos')`.

## Features

- **Top-right floating**: pinned at 72px top / 16px right, never covers the
  conversation body; renders only when a session exists and the task list is
  non-empty (no placeholder on the new-conversation screen or empty lists).
- **Progress summary**: the header shows `completed/total`; a thin progress
  track below fills by completion ratio, with progressbar semantics for
  assistive tech.
- **Three-state rows**: pending (hollow circle) / in progress (pulsing dot,
  highlighted row) / completed (check circle, struck-through dimmed text); the
  active row is subtly highlighted so the current step is obvious.
- **Collapse / expand**: click the header to collapse into a summary strip
  (count still visible), click again to expand; collapse state is persisted
  per session in localStorage.
- **Live following**: tracks the sessions list `current` selection; within a
  session, `todo/write` frames refresh the board immediately.

## Layout

```
package.json / tsconfig*.json / tsdown.config.ts / vitest.config.ts   # standalone build
src/index.ts                                  # host half: system-prompt section only
src/client/index.ts                           # apply(ctx): subscribe sessions + mount on document.body
src/client/CodexBoard.tsx                     # floating board component (progress + rows + collapse)
src/client/codex-board.module.css             # styles (--dsw-* tokens, skin-aware)
src/client/locales.ts                         # zh/en copy
src/core/derive.ts                            # pure derivation: progress / collapse persistence
tests/derive.spec.ts                          # core unit tests
tests/codex-board.spec.tsx                    # component smoke + interaction tests
```

## Install

Prefer the aggregate bundle `@linxin666/dsh-web-ui-all`, or install this
plugin alone:

```sh
### From npm (recommended)
dsh plugin --profile web add @linxin666/dsh-client-ui-codex-board

### From the repository (development)
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-codex-board
```

**Restart `dsh web`** after installing; a page refresh is not enough — the
process must be restarted for the bundle row to load.

## Build

Prerequisites: Node >= 22, official NPM SDK reachable. Types and runtime APIs
all come from the official `@deepseek-ai/*` SDK packages (devDependencies); no
DSH source checkout is needed.

```sh
cd ~/code/dsh-web-ui/packages/dsh-codex-board
pnpm install        # first time (run pnpm install at the workspace root)
pnpm run build      # emits lib/index.js + lib/client.js (tsdown + shared/tsdown.client.ts preset)
pnpm run typecheck  # type check (SDK package types from node_modules)
pnpm test           # vitest unit tests
```
