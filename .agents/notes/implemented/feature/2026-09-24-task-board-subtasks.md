# Agent Note: Task-board subtasks and cascade runs

Status: implemented

## Problem

The board modelled every task as an independent card. Work that naturally decomposes — a migration touching three modules, a review with a follow-up fix, a release sweep — had to be typed as several unrelated tasks, and the relation between them lived only in the user's head. The request was to make that relation first-class: a task can carry subtasks, and running it runs the group. The same request named the failure mode to avoid: a tree that cascades without a ceiling multiplies sessions on every run, so the default depth is a single subtask level, configurable up to three.

## Decision

A task row carries an optional `parentId` and the Host is the only writer of that link. The deployment setting `maxSubtaskDepth` (1..3, default 1) bounds the tree: at 1 a task may carry one level of subtasks and a subtask may not be given subtasks of its own; 2 and 3 deepen the tree. `src/core/subtask.ts` owns the lineage gate, the cascade shape, the inheritance resolution and the deferred-settlement fold, and the ledger, the use cases and the browser affordances all read that one module.

### Lineage gate

- Creation takes an optional `parentId`; the `set-parent` action attaches an existing on-board task or detaches it with `null`. Both run the same predicates: the parent must exist and be on board, a task may not be attached under itself or one of its own descendants, and the resulting depth (parent depth + 1 + the moved task's own subtree height) must stay within the limit. A refusal is a Host error; nothing is repaired silently.
- Deleting a task that still has subtasks is refused, so the user detaches or deletes the children explicitly. Archiving a parent archives its whole subtree and is refused while any member has an open execution; restoring a task restores its ancestors and its subtree, so an on-board subtask never points at an archived parent. A task with an open execution cannot be re-parented or detached either: its link may still be a running group's parent pointer, and moving it would strand that parent.
- A load or an import repairs a dangling link (parent missing, cyclic, or archived while the child is on board) by dropping only the link, never the task row; a chain deeper than the current limit is kept, because the limit gates new links and every cascade walk is bounded by it anyway.

### Cascade runs

- `run` and `rerun` open one execution per participant — the requested task and its on-board descendants within the limit — under a single `runGroupId`, and the Host service launches each of them separately. A participant that already has an open execution is skipped and never joins the group.
- A parent records its own session outcome on the execution (`ownResult` and `ownError`) and stays open: the card remains in the running column until its own turn and every direct subtask in the group have settled. The final verdict folds own and children outcomes with failure dominating, then cancellation, then success, and the first failure text is kept.
- The Host monitor skips an execution whose own outcome is recorded, because there is nothing left to inspect. A child's settlement walks up the lineage and finalizes every parent that became ready, and restart recovery takes the same path after cancelling the participants that never recorded a session. The group id, the own outcome and the resulting settlement are persisted, so a restart still finalizes a deferred parent.
- Cron uses the same path: a due task opens the whole tree, and a tree containing an unconfirmed elevated permission is refused as a unit, with the schedule rolling to its next occurrence and the reason recorded in the scheduler error.

### Agent Team runs (opt-in)

- The per-task `teamRun` flag switches one cascade from "one session per participant" to "one Lead session plus one teammate per participant". The Host launches only the root, then asks the optional Agent Teams service — `ctx.agentTeams.spawnTeammate(leadAgent, { name, description, prompt, context, provider, signal })` with the live Lead from `ctx.agents.get(sessionId)` — to spawn a teammate per other member, and attaches each teammate's session id to that member's execution. Settlement is unchanged: the ordinary session monitor inspects the attached session, and the parent still folds its direct children.
- The subtree is flattened into that one Team because only a Lead may spawn; a teammate name is the member title slug, the run-group token AND a digest of the member's task id. The two discriminators answer two different collisions: the token separates repeated runs of one tree, and the member digest separates members of the SAME run. The digest is required because a CJK-only title slugs to the empty string, so every such member of one run would otherwise share the single generic prefix and the second spawn would be refused with `TEAM_MEMBER_NAME_TAKEN`; it also covers two members that share a title outright. The name stays lower-kebab-case and within the service's 64-character bound. A team run always mints a fresh Lead session (teammate names are immutable within one Team, so reusing an older session would collide), and the provider comes from the `teamProvider` config (default `spawn`).
- The mode fails closed rather than degrading: a deployment that serves no `agentTeams` service refuses a manual team run by name (and records the reason for a scheduled one), and a member whose OWN binding is above the session default is refused because a teammate runs inside the Lead session and cannot carry that pin. An inherited binding belongs to the Lead and passes through the Lead's own confirmation gate.
- Both modes state the run's shape in the launched prompt: a cascade lists the independent sessions it opens, while a team run says that this session is the Lead and lists every teammate by name together with the team tools.

### Execution-target inheritance

- A subtask's own workspace, agent preset, permission and model win; anything left unset resolves to the nearest ancestor at launch, up to the root. Creation prefills the parent's workspace, preset and model into the form while the permission picker stays at inherit, and the stored card keeps only what it was actually given.
- An inherited permission is the ancestor's effective binding (its handover pin included) and carries that ancestor's confirmation stamp, so a subtask of an already-confirmed elevated card is runnable, while a subtask that pins or bundles its own permission keeps its own gate. The gate judges the resolved binding, so an unconfirmed binding anywhere in the tree refuses the whole run before any session starts.
- The permission is resolved, never copied: a subtask stores no inherited binding and no inherited confirmation, so detaching it leaves an ordinary card instead of a confirmed elevated one. Copying the binding at creation would have had to copy the human's confirmation with it, and one confirmed parent would then have minted unbounded detached elevated cards — the escalation the create path therefore no longer performs.

### Board surfaces

- The task detail block shows the parent link, the direct subtasks with their statuses, an add-subtask form that starts from the parent's execution targets, a linker for an existing root task, and a detach action; at the depth ceiling the add controls give way to the limit explanation, and both the detach action and the linker's candidate list leave a running task alone. The add-subtask form leaves the permission picker at "inherit parent", which is what makes the Host inherit the binding together with its confirmation.
- Cards carry a subtask badge (count on a parent, a marker on a child, and a waiting label while a cascade parent is deferred), the board header offers a hide-subtasks filter, and the settings card exposes the depth limit as a 1/2/3 choice. The depth field is schema-volatile like the card's other fields — the Host settings write path fences edits on volatility — and a committed edit reaches the running row through `loader/volatile-update`, which re-reads the reference and applies it to the live ledger (`setMaxSubtaskDepth`) without a remount. The browser's Host mirror now carries the deployment constants (session-default permission and subtask depth) across SSE heartbeat frames, which it previously dropped.

## Alternatives considered

**Serial cascade, where the parent runs to completion before its subtasks start.** Rejected: the parent's own turn can be long, the children rarely depend on its result byte-for-byte, and a stuck parent would then hold the whole group; the chosen design opens the group concurrently, which is also what the requester asked for.

**A data-only parent link with no cascade.** Rejected: the request was explicit that running a task runs the group, and a link nobody acts on is a label rather than a relation.

**A first-class run-group entity in the ledger, with its own document section and migration.** Rejected: the group id on execution records plus deriving children from `parentId` already answers every question the monitor asks, and a new section would deepen the v3 document and the recovery path for no gain.

**A fixed depth of one level.** Rejected in favour of a configurable ceiling: the request allowed deeper trees, and the clamp to 1..3 keeps a misconfigured value from lifting the guard.

**Cascading delete of a parent's subtree.** Rejected in favour of an explicit refusal: deleting a parent is destructive, so the user decides what happens to the children instead of the Host guessing.

**Bumping the ledger schema to v4.** Rejected: the lineage fields are additive and optional, so a bump would only risk quarantining an older build's file for no compatibility gain.

**A dedicated hierarchy or tree view on the board.** Deferred, not built: the badges, the detail block and the hide-subtasks filter answer the day-one questions, and a second board layout would double the rendering and responsive paths.

## Consequences

- One run of a task can open several sessions at once: with the default depth that is one session per direct subtask, and each consumes API quota like any other DSH session.
- The parent card is an aggregate: it stays running until the whole group settles and its status is the group verdict, so a done parent can hide the detail of a failed child until the user opens the tree.
- A subtask keeps its own execution history, tags and schedule; detaching or re-parenting it changes only the link.
- The lineage fields are additive and optional within ledger v3: a document written before the feature loads unchanged, and an older build reading a newer document ignores `parentId`.
- Required verification: `tests/subtasks.spec.ts` covers the gate, the inheritance and the fold rules, `tests/subtask-run.spec.ts` covers cascade grouping, deferred settlement, cron refusal and restart recovery, `tests/subtask-view.spec.tsx` covers the detail block, the linker and the board filter, and the package `typecheck`, `test`, `build` plus `pnpm i18n:check` are the gates.
