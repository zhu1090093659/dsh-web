# Agent Note: Task Board task duplication and edit-as-copy workflow (Issue #1413)

Status: implemented

## Problem

In task-board, users frequently configure tasks with detailed prompt instructions, execution settings (workspace, agent mode, permissions, model), or complex cron schedules. Previously, there was no way to duplicate an existing task:
1. Re-running a completed or failed task required either reusing the old task row or manually re-entering all prompts, descriptions, and execution configurations into a blank form.
2. Minor variations or branching off existing tasks required tedious copy-pasting across fields.
3. Users iterating on task runs had to manually find and archive the predecessor task after creating a revised copy.

## Decision

We implemented task duplication and "edit-as-new-copy" workflows directly within the task detail panel and new task modal:

1. **Detail Action Integration (`TaskDetail.tsx`)**:
   - Added a "Duplicate Task / Edit Copy" action button to the action bar of `TaskDetail`.
   - Clicking opens `NewTaskModal` pre-filled with the original task's complete configuration template (`initialTask`).
2. **Template Pre-filling & Copy Adaptation (`NewTaskModal.tsx`)**:
   - Form initializes with title, description, prompt, workspace, mode, permission, model, and cron schedule from `initialTask`.
   - Title automatically appends " (Copy)" / "（副本）" if not already present.
   - Clean slate: `executions` history and runtime IDs are discarded for the new copy so it starts clean.
   - Added an "Archive original task upon creation" checkbox (defaulting to checked) allowing one-click transition from old tasks to new duplicates.
3. **i18n Support (`locales.ts` & `dsh-i18n`)**:
   - Added `detail.duplicate`, `detail.duplicateAndEdit`, `new.duplicateTitle`, and `new.archiveOriginal` across Chinese, English, and Russian dictionaries with 100% parity.

## Testing

- Added `packages/dsh-task-board/tests/task-duplicate.spec.ts`: verified pre-filling of all fields, copy title adaptation, archive original checkbox toggle, and controller execution flow.
- All 35 test suites and 318 unit tests in `dsh-task-board` pass.
- Verified `pnpm typecheck`, `pnpm i18n:check`, `pnpm docs:check`, `pnpm test`.

## Consequences

Users can quickly clone and branch off tasks with all execution parameters intact, seamlessly archiving older iterations in a single flow.
