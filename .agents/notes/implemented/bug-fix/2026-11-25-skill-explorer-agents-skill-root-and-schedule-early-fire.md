# Agent Note: skills can be created into the shared agents root, and an early schedule tick still fires

Status: implemented

## Problem

The skill center listed `~/.agents/skills` (source group `user-agents`, rank 500) but its two write surfaces did not: `create` and `import` accepted only `root: "user"` (`~/.dsh/skills`) or `root: "project"` (`.dsh/skills`), and answered anything else with a 400. Putting a skill into the shared agents root therefore meant creating it in one root and moving the directory by hand, so the read and write halves of the same panel disagreed about which roots exist (`#2094`).

The task board's schedule timer had a second, unrelated defect: `HostTaskBoardService.onScheduleFire(target)` read `now = this.now()` and asked the ledger for schedules due at that instant. A native timer that fires a millisecond before the target it was armed for makes `dueSchedules(now)` skip the occurrence, and the following `armSchedule()` asks `nextArmedRunAt(this.now())`, which only accepts targets strictly in the future. The rule keeps a `nextRunAt` in the past, is never re-armed, records no missed occurrence, and stops firing for good (`#2093`).

## Decision

`create` and `import` accept `root: "agents"` and write under the resolved agents home: `collect.ts` exports `agentsSkillRoot(agentsHome)` as the shared-root convention beside `userSkillRoot`, and both routes resolve it through the same `SkillRoutesDeps.agentsHome` the read path scans. The import route stamps `targetLevel: 'user-agents'`, so the existing `SKILL_SOURCE_RANK` conflict ruling reports a name the `user-dsh` root already owns as `shadowed` and a name inside the agents root as `exists`.

The panel offers the third root in both the create and import selects. Its label is the `create.root.agents` key in the plugin's zh/en dictionaries and in the `dsh-i18n` Russian dictionary.

`onScheduleFire` takes the instant it was armed for as covered: `const now = Math.max(this.now(), target)`. An early callback therefore delivers the occurrence and rolls `nextRunAt` to the next cron match from the target, while a fire past `RECOVERY_TOLERANCE_MS` still satisfies `now - target > RECOVERY_TOLERANCE_MS` and keeps the existing recovery path.

## Testing

`packages/dsh-skill-explorer/tests/routes.spec.ts` covers both write paths (the file lands under the resolved agents home and not under `~/.dsh/skills`) and the `shadowed` ruling against a `user-dsh` copy.

`packages/dsh-task-board/tests/host-service.spec.ts` covers an early recurring fire (one execution, `nextRunAt` rolled to the next minute, timer re-armed) and a fire past the recovery tolerance (no execution, occurrence skipped). Reverting the `Math.max` line makes the early-fire case fail with `expected "vi.fn()" to be called once, but got 0 times`.

## Alternatives considered

**Let `root` accept any source level key and look the directory up in `SOURCE_GROUPS`.** Rejected as the smaller change for now: the write roots and the scanned roots are not the same set (custom loader directories are read-only, and registry levels have no writable path), so the lookup needs its own allowlist anyway; widening the parameter without that work would only move the validation.

**Treat an early fire by re-arming with `nextArmedRunAt(target)` instead of clamping the clock.** Rejected: the ledger call also drives `openScheduled(taskId, now)`, whose run budget and `triggeredAt` belong to the occurrence being delivered. Clamping keeps one clock for the whole firing instead of two spellings of the instant.

**Let `nextArmedRunAt` accept `nextRunAt >= now`.** Rejected: an unarmed timer plus a due rule would then re-arm at a zero delay and spin, and the same predicate decides whether a rule is already past in recovery.

## Consequences

The three surfaces (list, create, import) now agree on the roots they serve. `~/.agents/skills` keeps its rank-500 position, so a skill created there is shadowed by a same-name `~/.dsh/skills` skill exactly as the list already reported.

A schedule occurrence that the Host clock reports a moment early is delivered instead of silently stranded. The clamp never moves the clock backwards, so a genuinely late fire and the boot-time skip path behave as before.