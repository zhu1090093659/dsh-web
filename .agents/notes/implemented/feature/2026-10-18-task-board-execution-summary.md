# Agent Note: Task board execution summaries

Status: implemented

## Problem

A task board card recorded one verdict per execution attempt and nothing else: `result`, the failure text in `error`, and the cascade bookkeeping. A card that ran successfully therefore left no trace of what it produced, and a parent card inspecting its subtasks could only see that they succeeded — not what they delivered. The reader's remaining options were to guess, or to redo the work.

The obvious alternative, letting a finished subtask rewrite its own `description`, is closed by design: card content is the plan, and `canEditTaskContent` (`core/use-cases/task-update.ts`) freezes title, description and prompt at the first execution record. That freeze exists so the prompt an agent was given stays auditable; re-opening it to carry output would make the plan mutable after the fact.

## Decision

An execution record carries an optional `summary`: the text of the run's last assistant message plus the `seq` of the session event it was read from (`ExecutionSummary` in `core/tasks.ts`, bounded by `EXECUTION_SUMMARY_LIMIT` = 4000 characters).

The text is taken at settlement, from the events the inspection already read. `HostExecutionRunner.inspect` resolves the verdict from the session history; the closing prose of that same window rides the verdict object (`ExecutionInspection.summary`) into `TaskBoardHostService.settleAndNotify`, which hands it to `HostTaskLedger.settle` and thus to the record. The extraction itself (`core/execution-summary.ts`) is pure: it takes the events, the execution's start instant and nothing else.

Rules the implementation holds:

- **Window.** Only events at or after the execution's `startedAt` count. A reused session carries earlier executions' history, and their closing words are not this run's output.
- **Last message with prose.** A trailing tool-call or reasoning-only message has nothing to record, so the reader walks back to the last assistant message that carries text blocks. Reasoning and tool traffic are excluded deliberately: a summary that opened with a tool call or reasoning block would bury the conclusion.
- **Truncation.** Over the limit, the tail is kept and the omitted length is announced as a `[truncated N chars]` prefix. The closing paragraphs carry the conclusion; a reader that needs the whole message follows `summary.seq` into the session history.
- **Absence, not emptiness.** No assistant prose, an unreadable session, or a launch failure before any session existed leaves the field out entirely. Nothing in the settlement path depends on a summary, so settlement never fails over it.
- **Failures keep their text too.** The `error` field keeps its historical meaning; a failed run's closing words are recorded beside it rather than replacing it.
- **Cascade.** A cascade parent records its own turn's summary with its own outcome (`ownResult`), and the later fold that finalizes the card — which has no session of its own — leaves what is already recorded in place.

The field is additive and optional in both directions. An older document has no `summary`, and `parseLedger` repairs whatever it finds there: an unusable value is dropped on its own instead of costing the execution or the task row. `isTaskRecordShape` is unchanged, so an older Host reading a newer document is also unaffected; no ledger schema bump is involved because no migration is needed.

Both halves of the board read the same snapshot: `TaskBoardHostService.snapshot()` returns the ledger's task rows verbatim, so the field reaches the phone and the desktop bridge without a protocol change, and a client that does not know the key ignores it.

The agent tool face (`executionView` in `src/host/agent-tools.ts`) deliberately does not project the summary: `task_board_get` lists up to ten executions of one task, and ten transcript fragments of 4000 characters would flood the model's context. The record is the source of truth; projecting it into a tool result is a separate decision with its own budget question.

## Alternatives considered

**Let the finished card rewrite its own description with what it delivered.** Rejected: it is the designed freeze (`canEditTaskContent`), and removing it would make the plan — the very text the agent was prompted with — mutable after execution, which is the audit property that freeze exists for.

**Store the full transcript instead of the closing message.** Rejected: the ledger is a decision record, not a session mirror. It would multiply ledger bytes per execution, duplicate history the session store already owns, and hand every reader far more than "what did this run deliver".

**Keep the head of an overlong message rather than its tail.** Rejected: an assistant's closing paragraphs state the conclusion (what was shipped, what failed), while the opening paragraph is usually framing. The board's historical acceptance evidence bounded from the tail for the same reason.

**Emitting an empty string when nothing was readable.** Rejected: it would make "produced nothing" indistinguishable from "the board could not read the session", which is exactly the distinction a parent card needs when deciding whether to trust a success.

**A summary per cascade fold rather than per execution.** Rejected: the fold has no session to read, and a folded text would be a synthesized claim about work no single session performed.

## Consequences

A settled execution now answers "what did it deliver" from the board snapshot alone, so a parent can read a subtask's result instead of repeating it. The cost is up to 4000 characters per execution record, bounded by the existing 20-execution retention per task.

A summary is informational in every direction: it never changes a verdict, never gates a column move, and its absence is the normal state for runs that produced no prose, for executions settled by a reader that could not open the session, and for every record written before this change.

Verification: `tests/execution-summary.spec.ts` pins extraction, the execution window, truncation, repair, persistence, both settlement paths and the snapshot; `tests/host-runner.spec.ts` pins that the verdict the runner returns carries the closing text. The package gate is `pnpm --filter @linxin666/dsh-client-ui-task-board test` plus the repository `pnpm test`, `pnpm typecheck` and `pnpm build`.

The [card surface contract](2026-10-20-task-board-card-surface-contract.md) owns the type scale, outcome slots and fold behaviour of these surfaces.
