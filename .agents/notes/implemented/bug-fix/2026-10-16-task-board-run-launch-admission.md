# Agent Note: Run launch admission bounds a subtree's session burst

Status: implemented

## Problem

One board action could ask DSH to create a whole subtree's sessions in a single tick. Measured through the real entry point against a counting gateway, a 40-subtask tree issued 41 `session/create` calls with a peak of 41 concurrent, and nothing bounded it: not this repository, and not the runtime, whose subagent package declares recursion depth but no fan-out width and whose settings schema has no subagents key at all. The repository's measured guidance caps heavy implementation subagents at three ([multi-agent resources](../../../../docs/multi-agent-resources.md)), and nothing enforced that guidance. Two dispatch paths fired this way — the plain cascade, one session per member, and a team run, which hands every member to the Lead at once.

## Decision

One service-wide admission queue gates the session-creating half of every launch on both dispatch paths, and its width is read through a live callback so a settings edit applies to the next admission.

The queue is service-wide rather than per run group because the pressure it bounds is the machine's — the Host process's memory and the swap it drives — and two run groups opened from two tabs share one Host, so a per-group limit would multiply the burst by the number of tabs rather than bound it. Admission is round-robin across run groups and FIFO inside one, which keeps a group's first entry its root (the run that carries the run shape and the teammate namespace) and stops a large subtree from starving a run opened after it.

A slot is held until the launch promise settles, so "in flight" means "still creating and prompting its session", and it is taken synchronously before the launch starts so a single pump cannot over-admit. `runLaunchWidth` (1..16, default 3, volatile) has its single source of truth in `src/core/launch-width.ts`, mirroring how `src/core/poll-cadence.ts` owns the poll cadence.

Two details became load-bearing once the queue existed. A run group freezes the Host model catalog once, at its first admission, and hands that same value to every later member ([goal acceptance itself was later removed](../simplification/2026-11-11-remove-task-board-goal-run-and-acceptance.md)): freezing before the session is prompted stops a catalog change mid-queue from reaching only later members. A failed read is not cached, so the next member reads again exactly as a per-execution read did. And because waiting for a slot is time an execution can be settled in — by a manual settle, or by a team run folding onto its Lead's verdict — a launch whose execution has already closed is dropped instead of creating a session that nothing observes.

## Alternatives considered

**A per-run-group width.** Rejected: it bounds the wrong resource. The hazard is the Host's memory, which every tab and every group shares, so N groups would still produce N × width sessions at once.

**Delaying ledger admission so members enter the running column in waves.** Rejected: it would break the run group's atomic opening and the parent/child settlement rules that depend on it, a far larger change than the burst it removes.

**A single global FIFO instead of round-robin.** Rejected: one large subtree would head-of-line block every run opened after it.

**A semaphore inside the runner's own launch.** Rejected: a team run's members never pass through it — they are spawned through the Agent Teams service — so both paths have to be covered at the dispatch point.

**Refusing a run whose subtree outgrows the width.** Rejected on the requester's decision: it contradicts the written promise that a run group opens its whole subtree, turning a card into a partial run. The queue keeps every member eventually starting and changes only when they start.

## Consequences

A card whose subtree has more members than the width now starts them in waves, so a member can sit in the running column before its session exists. That is the only observable difference: the group still opens its whole subtree, one member's failure still settles only that member, and the parent still settles after its own turn and every direct subtask. When the Host stops, members still waiting are settled as `cancelled` — the same verdict the next start's interrupted-start recovery records for an execution that never reached a session — and a scheduled occurrence that never reached a session is refunded on the pre-session terms, so a run the Host never started cannot spend run budget.

## Testing

A counting gateway over the real entry point pins the bound: the same 40-subtask tree that produced 41 concurrent creations peaks at the configured width instead, while all 40 members still start. The assertions say "equal to the width", not "less than the unbatched count", so a queue that merely reduced the burst would fail. Bypassing the queue turns nine of the new assertions red, and the bypass was reverted byte-identically. Further cases cover round-robin fairness between a large group and a small one, a live width change while members wait, a member settled while queued never starting afterwards, one member's creation failure not holding the others back, and the Host stopping with members still queued. `pnpm --filter @linxin666/dsh-client-ui-task-board typecheck`, `test` (1119 pass, 1 skip), `build` and `pnpm i18n:check` pass.
