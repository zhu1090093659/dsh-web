# Agent Note: Task-board subtasks and parent-card dispatch

Status: implemented

## Problem

The board modelled every task as an independent card. Work that naturally decomposes — a migration touching three modules, a review with a follow-up fix, a release sweep — had to be typed as several unrelated tasks, and the relation between them lived only in the user's head. The request was to make that relation first-class: a task can carry subtasks, and running it accounts for the group. The same request named the failure mode to avoid: a tree that cascades without a ceiling multiplies sessions on every run, so the default depth is a single subtask level, configurable up to three.

## Decision

A task row carries an optional `parentId` and the Host is the only writer of that link. The deployment setting `maxSubtaskDepth` (1..3, default 1) bounds the tree: at 1 a task may carry one level of subtasks and a subtask may not be given subtasks of its own; 2 and 3 deepen the tree. `src/core/subtask.ts` owns the lineage gate, the dispatch set a run must pick up, the forced preset, the inheritance resolution and the historical-group fold, and the ledger, the use cases and the browser affordances all read that one module.

### Lineage gate

- Creation takes an optional `parentId`; the `set-parent` action attaches an existing on-board task or detaches it with `null`. Both run the same predicates: the parent must exist and be on board, a task may not be attached under itself or one of its own descendants, and the resulting depth (parent depth + 1 + the moved task's own subtree height) must stay within the limit. A refusal is a Host error; nothing is repaired silently.
- Deleting a task that still has subtasks is refused, so the user detaches or deletes the children explicitly. Archiving a parent archives its whole subtree and is refused while any member has an open execution; restoring a task restores its ancestors and its subtree, so an on-board subtask never points at an archived parent. A task with an open execution cannot be re-parented or detached either: its link may still be a running group's parent pointer, and moving it would strand that parent.
- A load or an import repairs a dangling link (parent missing, cyclic, or archived while the child is on board) by dropping only the link, never the task row; a chain deeper than the current limit is kept, because the limit gates new links and every descendant walk is bounded by it anyway.

### Single-card runs and parent-card dispatch

- `run` and `rerun` open one execution — the requested card's — under a fresh `runGroupId` that stays single-member. No execution is opened for any descendant, and a subtask never enters the running column because its parent ran. Running a subtask directly is the same operation: that card is the root of that run whether or not it carries a parent and subtasks of its own, and nothing below it is expanded.
- A card whose tree still holds work runs as an autonomous dispatcher. "Still holds work" means a descendant outside the `done` column that is not archived; `hasOutstandingDescendants` in `src/core/subtask.ts` is the one rule behind both the forced preset and the prompt's dispatch section. The run is forced under `LIANGSHEN_PRESET_ID` (`liangshen`, shipped by `packages/dsh-liangshen`), applied per execution and never written into the card's `mode`, and session reuse is skipped so the run mints a fresh session. A deployment that registers no `liangshen` preset fails closed, with that missing preset as the reason on the card, and so does a deployment running the legacy Agent Teams generation, whose one fingerprint is `LEGACY_AGENT_TEAMS_TOOL`: the dispatcher preset cannot orchestrate there (it would stop and wait for a reply an unattended run never brings), so the launch is refused before any session exists and the card carries `LEGACY_AGENT_TEAMS_REASON` instead of sitting in the running column forever (issue #2031). The probe answers false whenever the deployment's tool registry cannot be read, so a deployment that serves no registry keeps the force exactly as it was. A card with no unfinished descendant runs exactly like any ordinary card.
- The dispatch section names each unfinished card by title, task id and status, states that the Host opens no session for them, and asks the session to read each one with `task_board_get`, dispatch it with `subagent` in dependency order (independent cards may run together), and record the conclusions with `task_board_manage({action:'record-external-outcome'})` before it finishes.
- A conclusion that never arrives is supplied by the Host: once the run card's own execution reaches a decisive verdict, every still-unrecorded descendant of its unfinished set inherits that verdict as an external record whose `initiatedBy` carries the prefix `parent-run:` and whose reason says the card ran no session of its own and inherited the parent run's conclusion. The backfill is idempotent — a card holding an execution in this group, an open execution, or a later terminal record is left alone — and a cancelled parent judges nothing, so it writes nothing.
- Cron takes the same path: a due card opens its own run, and the single-card gates (busy, unconfirmed permission, spend budget) are what refuse it.
- Run groups opened before this shape are still folded: a member settles on its own turn, a stored group parent finalizes once its own outcome is recorded and no group child is still open (failure dominating, then cancellation), and boot recovery and every roster poll fold each already-decided run. The fold is idempotent, so an old run never hangs the board.

### Agent Team runs (retired)

- It was introduced to make one execution cover a whole tree: a cascade opened one session per member, so a subtree of five tasks cost five top-level sessions fanned out from a single action. A per-task team switch flattened the subtree into one Team instead — the Host launched only the root, that Lead spawned one teammate per other member through `ctx.agentTeams.spawnTeammate`, membership was governed by the Lead's verdict, and a teammate that never reported could not hold the lineage open.
- It was retired because a teammate is derived all at once, exactly like the Host's own launcher: the Lead cannot wait for one teammate's result before deriving the next, so subtasks with a serial dependency still ran in whatever order the derivation happened to pick. The mode had made the sessions fewer, not the ordering right, and it added a second run shape to the board's vocabulary — a per-card switch, a team-provider config, a service-dependent fail-closed path, and a detail-view toggle whose preference did nothing on a deployment without Agent Teams. Parent-card dispatch replaced it: the card's own session is the only place that sees each subtask's outcome before deciding what to run next, so ordering belongs to the agent rather than to the scheduler.
- The whole surface is gone: the protocol's create/patch team fields, the snapshot's team-availability flag, the agent-tools team-run parameter, the team-provider config, and the Host-side `spawnTeammate` scheduling face. `TaskRecord.teamRun` remains only so a ledger written by an older build still reads — it is not migrated, never written anew, and never changes how a card runs.
- Team run groups already in a ledger still settle: a Lead that recorded its own outcome closes whatever the Team still holds open, and the boot-recovery fold above finalizes the group the same way it finalizes any stored multi-member group. That path is kept on purpose, so an old run cannot hang the board.

### Execution-target inheritance

The [reasoning-effort decision](2026-10-11-task-board-reasoning-effort.md) owns model-coupled effort inheritance.

- A subtask's own workspace, agent preset, permission and model win; anything left unset resolves to the nearest ancestor at launch, up to the root. Creation prefills the parent's workspace, preset and model into the form while the permission picker stays at inherit, and the stored card keeps only what it was actually given.
- An inherited permission is the ancestor's effective binding (its handover pin included) and carries that ancestor's confirmation stamp, so a subtask of an already-confirmed elevated card is runnable, while a subtask that pins or bundles its own permission keeps its own gate. The gate judges the binding the card being run resolves: a subtask's own unconfirmed pin is that subtask's gate when the subtask runs, and no longer blocks its parent, which opens no session for it.
- The permission is resolved, never copied: a subtask stores no inherited binding and no inherited confirmation, so detaching it leaves an ordinary card instead of a confirmed elevated one. Copying the binding at creation would have had to copy the human's confirmation with it, and one confirmed parent would then have minted unbounded detached elevated cards — the escalation the create path therefore no longer performs.

### Board surfaces

- The task detail block shows the parent link, the direct subtasks with their statuses, an add-subtask form that starts from the parent's execution targets, a linker for an existing root task, and a detach action; at the depth ceiling the add controls give way to the limit explanation, and both the detach action and the linker's candidate list leave a running task alone. The add-subtask form leaves the permission picker at "inherit parent", which is what makes the Host inherit the binding together with its confirmation.
- Cards carry a subtask badge (count on a parent, a marker on a child, and, for a run group opened before this shape, a waiting label while a deferred parent is still settling), the board header offers a hide-subtasks filter, and the settings card exposes the depth limit as a 1/2/3 choice. The depth field is schema-volatile like the card's other fields — the Host settings write path fences edits on volatility — and a committed edit reaches the running row through `loader/volatile-update`, which re-reads the reference and applies it to the live ledger (`setMaxSubtaskDepth`) without a remount. The browser's Host mirror now carries the deployment constants (session-default permission and subtask depth) across SSE heartbeat frames, which it previously dropped.

## Alternatives considered

**A Host-side cascade that opens one session per member.** Shipped first, then rejected: the group started every member at once, so subtasks with a serial dependency ran in whatever order admission happened to admit them, and the parent could not feed one member's result into the next. The parent's own session now dispatches them, which keeps the ordering decision next to the results.

**A data-only parent link with no cascade.** Rejected: the request was explicit that running a card must account for its group, and a link nobody acts on is a label rather than a relation.

**A first-class run-group entity in the ledger, with its own document section and migration.** Rejected: the group id on execution records plus deriving children from `parentId` already answers every question the monitor asks, and a new section would deepen the v3 document and the recovery path for no gain.

**A fixed depth of one level.** Rejected in favour of a configurable ceiling: the request allowed deeper trees, and the clamp to 1..3 keeps a misconfigured value from lifting the guard.

**Cascading delete of a parent's subtree.** Rejected in favour of an explicit refusal: deleting a parent is destructive, so the user decides what happens to the children instead of the Host guessing.

**Bumping the ledger schema to v4.** Rejected: the lineage fields are additive and optional, so a bump would only risk quarantining an older build's file for no compatibility gain.

**A dedicated hierarchy or tree view on the board.** Deferred, not built: the badges, the detail block and the hide-subtasks filter answer the day-one questions, and a second board layout would double the rendering and responsive paths.

## Consequences

- One run of a task opens one session, the card's own. A card carrying unfinished subtasks additionally spends the quota of every subagent its session dispatches; the board itself opens nothing else.
- The parent card's verdict is its own turn's verdict. A subtask that never had a session of its own inherits that verdict as an external record that says so, so a reader can still tell what the parent decided without pretending the child ran.
- A subtask in the done column is outside the dispatch set, so running a parent after finishing its subtasks one by one costs one session instead of a repeat of the whole tree; the same rule covers a due occurrence, and a subtask that should run again is moved back to `todo` (or run on its own). Verdicts do not flow up the tree: the parent settles on its own turn, and a subtask that never reported inherits the parent's verdict instead of shaping it.
- A subtask keeps its own execution history, tags and schedule; detaching or re-parenting it changes only the link. A subtask whose own schedule is enabled settles into `todo`, so it stays in the next parent run's dispatch set.
- The lineage fields are additive and optional within ledger v3: a document written before the feature loads unchanged, and an older build reading a newer document ignores `parentId`.
- Required verification: `tests/subtasks.spec.ts` covers the gate, the inheritance, the subtree lifecycle and the dispatch set, `tests/subtask-run.spec.ts` covers the single-card run (manual, re-run and scheduled), the permission gate judged on the card being run, the dispatch section of the prompt, the inherited verdict each untouched subtask receives, the historical team-group fold and restart recovery, `tests/subtask-view.spec.tsx` covers the detail block, its run hint, the linker and the board filter, `tests/run-launch-width.spec.ts` and `tests/launch-admission.spec.ts` cover admission across several runs, and the package `typecheck`, `test`, `build` plus `pnpm i18n:check` are the gates.
