# Agent Note: Task runs start with dsh's built-in /goal

Status: implemented

Superseded by [Remove task-board /goal runs and goal acceptance](../simplification/2026-11-11-remove-task-board-goal-run-and-acceptance.md): the two-level `/goal` switch (`goalRunEnabled` and `TaskRecord.goalRun`), `/goal` command dispatch, and `session/projections` goal-phase settlement have been removed; every board execution now runs as a plain single turn, and legacy `goalRun` fields in v7 ledgers are ignored and dropped on load. The sections below record the historical 2026-09-27 design and are not authority for current behavior.

## Problem

A board run was one DSH prompt: the runner created (or reused) a session, applied the pinned permission and model, and queued the task text. The session ran exactly one turn, and the board settled it from that turn's `turn/end`. Long tasks that need many rounds of work — the case dsh's own goal feature exists for — therefore ended up half-done whenever the first turn ran out of steam: nothing on the board restarted the work, and the card reported success for a task that had only begun.

dsh ships the missing mechanism as the built-in `/goal` command (a persisted goal plus the goal-round driver, which queues the next round whenever the agent goes idle, until the agent marks the goal complete or it is blocked). The board never used it.

## Decision

Historically (removed 2026-11-11; legacy `goalRun` values are now ignored and dropped on load), a task row carried an optional `goalRun?: boolean`, edited by the former "start the run with dsh's built-in /goal" checkbox in the new-task dialog and in the task detail. In this initial design the option defaulted to ON (later inverted to opt-in and then removed altogether).

### Launch

- `HostExecutionRunner.pinAndPrompt` queues the task prompt first and arms `/goal <objective>` after it, on both the fresh-session and the session-reuse branch. The instruction turn therefore stays byte-identical to the pre-feature prompt, and the goal extends it rather than replacing it.
- The objective is the same composed prompt the session received (`promptText`, preambles and all), so the continuation rounds keep working toward exactly what the card says.
- `goalObjective` guards the command's own grammar: the `/goal` parser reads an exact `clear`/`pause`/`resume`/`edit` (case-insensitive) or a leading `edit <...>` as a goal operation, so an objective that begins that way is prefixed with a neutral label. A task prompt of "edit the README" arms `Goal: edit the README` instead of editing an unrelated goal.
- A refused or unacknowledged goal command is reported on the host console and the run continues as a plain single turn. The arming is a modifier of a run the user asked for, not a pin that fails closed: losing the whole exercise because the goal mode was unavailable would discard work the prompt already carries.

### Settlement

- `HostExecutionRunner.inspect` reads `session/projections` when it is about to settle an execution on a completed turn: an `active` goal means the goal-round driver still owns the session, so the execution stays `pending`; a `blocked` goal fails it with the recorded reason; `complete`, `paused`, or no goal at all leaves the turn verdict in place.
- Without that gate the first completed `turn/end` would settle the card as `done` while the session kept working, and a scheduled card would return to `todo` and fire a second, concurrent session for the same objective.
- The projection read happens only at the settle decision, not on every poll. An unreadable projection (a cohort whose gateway withdrew `session/projections`) falls back to the turn verdict with a warning, so a missing read cannot hang every execution.

- Goal acceptance (see [Task-board goal acceptance](2026-09-30-task-board-goal-acceptance.md)) gates the END of this loop: `update_goal(action: complete)` is refused until the board's acceptance records a pass for that execution, so a completed goal settles the card only when the WORK was judged. That note owns the acceptance rule, its per-execution budget and the settlement guard; this one still owns arming the goal, the refusal fallback, and reading the goal's phase at settle time.

### Wire, ledger, tools, UI

- `create` input and `update` patch accept the boolean; the update patch is tri-state (true or null returns the card to the default, false pins a plain turn). `parseLedger` keeps `false` and normalizes a stray `true` back to absent, because absent is the canonical on-state. No schema bump: the field is additive and optional.
- The import path carries the opt-out (`importedTask` copies it like `reuseSession`), and the security gate stays: import never carries a confirmation stamp.
- Historically (removed 2026-11-11), `task_board_create`/`task_board_update` exposed the option and the task view reported `goalRun: false` as the deviation from that initial default.
- Historically (removed 2026-11-11), the detail-view checkbox read `task.goalRun !== false` and wrote the boolean through the update action, while the new-task dialog only sent `goalRun: false` when unchecked.

## Alternatives considered

**A plugin-wide setting on the task-board settings card.** Rejected: the settings card is a deployment-level surface, and "this one task should run to completion, that one should not" is a per-card judgement the user makes while writing the task. A global switch would also silently change every existing scheduled card, with no way to exempt one.

**Prefixing the prompt text with `/goal `.** Rejected: a leading slash in a prompt is data, not a command. dsh dispatches slash commands through the command service (the same path `/permission` already uses), so a "`/goal ...`" message would arrive at the agent as literal text and arm nothing.

**Arming the goal instead of sending the prompt (goal-only runs).** Rejected: the goal round prompt embeds the objective as a JSON-quoted string, so the agent's first read of a multi-paragraph task would be an escaped one-liner. Queuing the prompt first keeps the instruction verbatim and makes the goal the continuation mechanism.

**Failing the launch when `/goal` is refused.** Rejected as above: the card was asked to run, and the prompt is already queued.

**Settling on the first turn end and letting the goal continue behind the board's back.** Rejected: the card would show `done` for unfinished work, and a scheduled card would start a second session for an objective a live session is still working on.

**Treating a goal that stays `active` while the session is idle as finished (a stall timeout).** Rejected: the goal-round driver queues the next round as soon as the agent goes idle, and the board polls every five seconds, so an idle-and-active observation is far more likely to be a poll landing between rounds than a stalled driver. A stall that is real surfaces as dsh's own `blocked` phase (round limit, failed queue, prompt rejection), which the board already reports as a failure.

## Consequences

- A goal run can work for many rounds in one session and consumes API quota for each of them; a task that never reaches completion keeps its session busy for up to the goal's own round limit, after which dsh blocks the goal and the card fails with that reason.
- The execution is `running` for as long as the goal is active, so session reuse, cron, and the running-task lock all behave as they do for any long run.
- Historically, `goalRun: false` restored single-turn behavior (now the universal behavior for every run after `goalRun` was removed in 2026-11-11).
- A deployment whose runtime serves no `/goal` command (or no command dispatcher) still runs every card; the goal mode is reported as unavailable in the host log instead of failing the run.
- Required verification: `tests/goal-run.spec.ts` covers the objective guard, prompt-then-goal ordering, the objective carrying the composed prompt, the opt-out, both refusal tolerances, and the four settlement verdicts; `tests/tasks.spec.ts`, `tests/store.spec.ts`, `tests/protocol.spec.ts`, `tests/agent-tools.spec.ts`, `tests/task-detail-edit.spec.tsx`, and `tests/new-task-run.spec.tsx` cover the field, the ledger repair, the wire gate, the tool surface, and both checkboxes. Package gates: `pnpm --filter @linxin666/dsh-client-ui-task-board test` and `pnpm i18n:check`.

See [task-board-session-reuse](2026-09-08-task-board-session-reuse.md) for the launch branch this extends, [inspect-head-probe-memo](../bug-fix/2026-08-26-inspect-head-probe-memo.md) for the inspection loop the settlement gate joins, and [issue-batch-1707-1708](../bug-fix/2026-09-23-issue-batch-1707-1708-sub-path-routes-and-failed-reuse-executions.md) for how a `turn/end` becomes a verdict.
