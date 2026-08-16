# dsh-branch — Trajectory rollback/restore with master/main trees

English | [中文](README.zh.md)

A hot-pluggable DeepSeek Harness (DSH) web GUI plugin that adds git-like rollback/restore to the official Trajectory tab **without touching its UI**: a DOM-level injector attaches a per-row action column to the shipped ledger (self-healing under virtualization) and a floating master/main tree switcher. Rolling back to a node creates a numbered master tree (master1, master2, ...) holding that node's file state; restoring returns the workspace to the main tree (the trajectory head state).

## Features

- Leaves the official Trajectory UI untouched: no view replacement, no restyling — only additive buttons and a small tree switcher.
- Every official row (and every file state between rows) gets rollback/restore actions; both compute the exact file state at that position from the trajectory's write/edit ops.
- Rollback creates a git-like master tree: master1, master2, ... (a later rollback to the same state reuses the existing tree instead of duplicating it).
- Restore returns to the main tree: all trajectory file ops applied, i.e. the workspace as the trajectory head left it.
- Floating tree switcher: current tree badge plus a menu to check out any stored master tree or main at any time.
- Confirmation modal previews every file change (create/write/delete/unchanged) before anything touches disk; files whose state is outside the trajectory window are reported as skipped, never guessed.
- Row mapping mirrors the official ui-trajectory cell-index enumeration read-only (core/official-rows.ts), so buttons land on the right rows without modifying dsh source.
- Tree registry persists per workspace in browser localStorage (content is never stored — states are re-derived from the trajectory ops).
- All file access goes through loopback-only, workspace-gated /branch/* routes; escaping paths and unregistered workspaces are rejected.

## Installation

```sh
### From npm (once published)
dsh plugin --profile web add @linxin666/dsh-client-ui-branch

### From this repository (development)
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-branch
```

- Restart `dsh web` after installing: the official Trajectory tab then shows the injected action column (a page refresh alone is not enough).

## Configuration

- No configuration file: the plugin activates on mount and disappears on unmount (injected DOM is removed).
- localStorage key (per origin, per workspace): `dsh-branch.trees.<encoded-cwd>` holds the tree registry.
- To reset all branch state for a workspace, remove the matching `dsh-branch.trees.*` key from the browser console.

## Known limitations

- Rollback/restore only applies file states derivable from the trajectory window: edits whose base state is unknown are skipped and reported; tool calls whose result is outside the window show no state.
- The tree registry is browser-local: it survives refresh and dsh restart, but switching browsers or clearing site data clears the trees (only the registry — files are untouched).
- The main tree tracks the trajectory head; a live session's head keeps moving, so master trees stay pinned to the state index where they were created.
- Row injection follows the official ledger's virtualization: buttons appear on rows as they enter the viewport (self-healing observer).
- File operations are real: confirm the modal before applying — there is no undo beyond creating another master tree and restoring to main.
