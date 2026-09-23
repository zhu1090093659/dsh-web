# Agent Note: Task board opt-in session reuse for repeated runs (Issue #1419)

Status: implemented

## Problem

Every task execution minted a fresh DSH session, so a high-frequency cron task
(for example a recurring review check) produced one new conversation per
trigger. The sidebar filled with near-identical sessions that users had to
archive by hand, even though the task's own prompt and pinned execution
targets were identical every time. The board needed a per-task way to keep a
recurring task in one conversation, without giving up the safety properties of
the existing one-session-per-execution contract.

## Decision

- `TaskRecord.reuseSession?: boolean` (absent/false = the historical
  behavior) is a per-task opt-in, set at creation, duplication, or from the
  task detail's execution settings. `false` clears it so the wire never
  depends on an `undefined` surviving JSON serialization.
- `src/core/session-reuse.ts` owns the whole rule as a pure function
  `reusableSessionId(task, idleSessionIds)`. Reuse requires all three of: the
  task opted in, the newest execution carries a session id and has settled, and
  that session is present and idle in the last roster. An unknown roster
  (`session/list` unavailable) never reuses, because minting a fresh session
  is always safe while prompting into an unobserved session is not.
- `TaskBoardHostService` caches the idle-session ids from its existing 5 s
  roster poll and passes the candidate to `HostExecutionRunner.launch`.
- `HostExecutionRunner.launch(task, { reuseSessionId })` continues in that
  session: no `session/create`, no `session/rename` (the conversation keeps
  its title and history), the pinned permission and model are re-asserted
  through the shared `pinAndPrompt` helper so the task's execution contract
  still holds, then the prompt is queued. Failures still surface as
  `SessionLaunchError` carrying the reused session id.
- Wire/store: `create`/`update` accept a boolean, `null`/`false` clear it,
  any other type is rejected; the ledger shape check rejects a non-boolean row
  and the parser normalizes a persisted `false` back to absent.
- i18n `exec.reuseSession` / `exec.reuseSessionHint` in zh/en plus the ru
  mirror, both READMEs, and the package AGENTS.md execution rule were updated
  in the same change.

## Testing

- `tests/session-reuse.spec.ts`: opt-in, unknown roster, running/gone session,
  open or session-less newest execution, and the reuse chain following the
  newest execution.
- `tests/host-runner.spec.ts`: the reuse path reaches the gateway only as
  `agentPresets/list`, the permission command, and `session/prompt` on the
  existing session; a failing reuse prompt reports that session id.
- `tests/protocol.spec.ts` and `tests/store.spec.ts`: wire acceptance and
  rejection, ledger normalization.
- `tests/task-detail-edit.spec.tsx`: the toggle renders, opts in with
  `{ reuseSession: true }`, and clears with `{ reuseSession: false }`.
- Gates run for this change: package typecheck and tests, `pnpm i18n:check`,
  `pnpm docs:check`.

## Alternatives considered

- Always reuse when the previous session still exists: rejected. A session the
  user is chatting in would receive the queued task prompt and the execution
  settle logic would race the user's own turn; requiring an idle roster entry
  keeps that impossible.
- Reuse without re-asserting the pins: rejected. A task whose permission or
  model was edited after the first run would silently keep the old values,
  breaking the fail-closed execution contract the board documents.
- Rolling rotation policies (new session every N runs / every N days / on
  context pressure): deferred. Context pressure is not observable to the Host
  through the current gateway surface, and the issue's primary request is the
  opt-in itself; a follow-up can add a rotation counter on top of this field.
- A separate "session group" entity: rejected. One boolean on the task keeps
  the ledger schema, the wire protocol, and the UI unchanged in shape.

## Consequences

- Recurring tasks can keep one conversation, so the sidebar no longer grows by
  one session per trigger.
- Reuse is best-effort by design: a busy or unseen session yields a fresh
  conversation rather than a delayed or blocked run, which is observable in
  the execution history (a new session id appears).
- The reused session keeps its original title, and the pinned permission and
  model are re-applied on every reuse.
