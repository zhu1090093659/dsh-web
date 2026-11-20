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
  `reusableSessionId(task, idleSessionIds, options)`. Reuse requires all four of:
  the task opted in, the newest settled execution carries a session id, that
  session is present and idle in the fresh roster, and it is not in the
  Workspace registry's archive set. An unknown roster (`session/list`
  unavailable) never reuses, because minting a fresh session is always safe
  while prompting into an unobserved session is not. An unreportable archive
  set is unknown evidence rather than an empty set, so that deployment keeps
  its existing reuse behavior.
- `TaskBoardHostService.reuseDecision` reads a fresh roster and archive set
  for each launch. `reuseSessionFor` passes a candidate to
  `HostExecutionRunner.launch`; an archived candidate yields a fresh session
  and a Host log naming the task and skipped session. `reworkSessionFor` uses
  the same evidence but stays fail-closed and names the archived session and
  the required unarchive action instead of silently starting a different
  conversation.
- `HostExecutionRunner.launch(task, { reuseSessionId })` continues in that
  session: no `session/create`, no `session/rename` (the conversation keeps
  its title and history), the pinned permission and model are re-asserted
  through the shared `pinAndPrompt` helper so the task's execution contract
  still holds, then the prompt is queued. When the reused session is a cold
  persisted row (present and idle in `session/list` but not yet in
  `ctx.agents`), `resolveExecutionAgent` in `src/index.ts` wakes its live
  Agent through `sessionController.resolveAgent(sessionId)` before
  `ctx.commands.execute` runs `/permission` (issue #1861), matching
  the activation path `session/selectModel` and `session/prompt` use. Failures
  still surface as `SessionLaunchError` carrying the reused session id.
- Wire/store: `create`/`update` accept a boolean, `null`/`false` clear it,
  any other type is rejected; the ledger shape check rejects a non-boolean row
  and the parser normalizes a persisted `false` back to absent.
- i18n `exec.reuseSession` / `exec.reuseSessionHint` in zh/en plus the ru
  mirror, both READMEs, and the package AGENTS.md execution rule were updated
  in the same change.

## Testing

- `tests/session-reuse.spec.ts`: opt-in, unknown roster, running/gone session,
  open or session-less newest execution, the reuse chain following the newest
  settled execution, and archive-set present/absent/unreportable cases.
- `tests/session-reuse-archive.spec.ts`: the service starts a fresh session
  when the settled conversation is archived, preserves reuse when the archive
  set is unreportable, and survives an unreadable roster without recording a
  launch error.
- `tests/extension-sessions.spec.ts`: rework refuses an archived conversation
  with its session id and unarchive instruction, without sending a prompt.
- `tests/host-runner.spec.ts`: the reuse path reaches the gateway only as
  `agentPresets/list`, the permission command, and `session/prompt` on the
  existing session; a failing reuse prompt reports that session id.
- `tests/host-apply.spec.ts`: `resolveExecutionAgent` returns a live Agent
  directly, wakes a cold reused session through
  `sessionController.resolveAgent` before `/permission`, and surfaces the
  controller's failure reason when a cold session cannot be resumed.
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
- Require the reused session to already be in `ctx.agents` and fall back to a
  fresh session when it is cold: rejected (issue #1861). After a DSH restart or
  during an unattended cron trigger, the previous session is present and idle
  in persistence (`session/list`) while no browser tab has called
  `session/follow` to promote it into `ctx.agents`; falling back to a fresh
  session would discard the conversation across every restart. Resuming the
  cold session through `sessionController.resolveAgent` preserves the
  conversation and reuses the official preset and model-selection restoration.
- Reuse without re-asserting the pins: rejected. A task whose permission or
  model was edited after the first run would silently keep the old values,
  breaking the fail-closed execution contract the board documents.
- Automatically unarchiving a conversation so the card can reuse it: rejected.
  Archiving is an explicit user organization action; starting a fresh session
  preserves that action and avoids the Host's archived-session gate.
- Rolling rotation policies (new session every N runs / every N days / on
  context pressure): deferred. Context pressure is not observable to the Host
  through the current gateway surface, and the issue's primary request is the
  opt-in itself; a follow-up can add a rotation counter on top of this field.
- A separate "session group" entity: rejected. One boolean on the task keeps
  the ledger schema, the wire protocol, and the UI unchanged in shape.

## Consequences

- Recurring tasks can keep one conversation, so the sidebar no longer grows by
  one session per trigger.
- Reuse is best-effort by design: a busy, unseen, or archived session yields a
  fresh conversation rather than a delayed or blocked run, which is observable
  in the execution history (a new session id appears). Archived reuse also
  emits a diagnostic Host log.
- The reused session keeps its original title, and the pinned permission and
  model are re-applied on every reuse.
- Archive detection is probe-then-act. Archiving during the remaining launch
  window can still hit the Host gate once; eliminating that race requires a
  synchronous Host-side decision at prompt admission.
