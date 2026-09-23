# Agent Note: Task Board archives every non-running task

Status: implemented

## Problem

Issue #1447: in the scheduled-task view the user picked "修改并新建副本" and kept the checked option "创建后归档原任务", but the original task was never archived and no error appeared.

The archive transition only accepted settled tasks (`ARCHIVABLE_STATUSES = ['done', 'failed']`), while a task that has any execution is exactly the one whose detail button turns into "修改并新建副本" — and a task with an armed cron returns to `todo` after every successful run. The client controller therefore refused the archive before any host request, both call sites (`TaskDetail`'s `onDuplicateSuccess` handler and `NewTaskModal`'s fallback branch) discarded the `false` result, and the modal closed as if it had worked. The host ledger shares the same function, so a client-only change could not have fixed it either.

## Decision

- `ARCHIVABLE_STATUSES` becomes `['backlog', 'todo', 'done', 'failed']`: every status but `running`, whose lifecycle the runner still owns until the execution settles. `applyArchiveTask` is the single gate used by the controller and the host ledger, so both sides widened together.
- Documented in `task-archive.ts` and `controller.ts` doc comments; the archive still disarms a schedule and keeps status, executions, and transcript references, and restore still clears only the marker.

## Testing

- `tests/task-archive.spec.ts` covers the new refusals and the reported scenario: a scheduled `todo` task archives and its cron is disarmed (`enabled: false`, `nextRunAt: undefined`, cron text kept).
- `tests/archive-controller.spec.ts` drives the real controller: `done`, `failed`, and `todo` archive and persist, `running` is refused.
- `pnpm --filter @linxin666/dsh-client-ui-task-board test` and `typecheck` pass.

## Alternatives considered

- Fail honestly instead: keep the settled-only gate and have the UI surface the refusal (new locale key, keep the modal open). Rejected as the primary fix because it does not deliver what the checkbox promises for scheduled tasks; the silent `running` case below is the remaining, much rarer, instance of that behavior.
- Send the archive flag with the create action instead of a follow-up archive call. Rejected: the archive is deliberately a separate same-origin action with its own ledger transition, and folding it into create would make one action perform two durable writes.
- Archiving from any status including `running`. Rejected: the runner owns a running task's lifecycle, and the ledger's scheduler state machine assumes it cannot disappear mid-execution.

## Consequences

- Duplicating a scheduled task with the checkbox on now retires the original: it leaves the columns, keeps its history, and its cron is disarmed until the user restores and re-enables it (restore does not re-arm the schedule).
- A `running` source is still refused by the client gate and the detail/modal still close without an error message; that residual silent no-op is untracked and would need the fail-honestly design (locale key plus UI state) to close.
