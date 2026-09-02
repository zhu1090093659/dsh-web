# Agent Note: Doctor boot self-heal quarantines the attributed plugin

Status: implemented

## Problem

The aggregate shell (see [aggregate-plugin-fault-isolation-shell](2026-09-01-aggregate-plugin-fault-isolation-shell.md)) contains one plugin's boot failure inside the family, but failures outside the shell's reach — a broken external plugin, a host-level fault, a profile patch hand-edited into a bad state — still kill the boot, and recovery stayed manual: read the boot error, work out which row broke, edit `cordis.patch.yml` by hand. The doctor Supervisor already watched boots (the launcher reports `launcher-exit` with a 32 KiB stderr tail and a `started` flag) and already had per-profile failure recording and a 2-strikes circuit breaker, but nothing in the loop mapped a failure to a plugin row or disabled one.

## Decision

The Supervisor now closes the loop at plugin granularity, behind `autoRepair` (default off, same switch as repair promotion):

- **Attribution** (`packages/dsh-doctor/src/core/boot-attribution.ts`, pure): the captured stderr is matched against the profile's own patch rows using the host's real message shapes (verified against `@deepseek-ai/dsh-app-boot` 0.1.2-alpha.3: `failed to apply|import loader entry <id> (...)` — including the nested same-line form where the include entry wraps the failing child row — plus the `plugin(s) failed to load: <ids>` audit list and per-entry activation lines matched via row name). Only positive matches count; a trace that names no owned row attributes nothing.
- **Quarantine write** (`packages/dsh-doctor/src/core/plugin-quarantine.ts`): appends a bare `- id: <rowId>` + `disabled: true` override to the profile `cordis.patch.yml` with a timestamped marker comment — the bare-row merge semantics the loader itself uses when persisting a self-disposing plugin. Idempotent (an existing override short-circuits to `already`), refuses rows the profile does not own, refuses empty or unparseable patch files (the D-040 lane owns those), and keeps every other line byte-identical.
- **Supervisor wiring** (`src/agent/supervisor.ts`): on a `launcher-exit` that failed before startup (`started: false`, non-zero, not intentional), with `fullProtection` and `autoRepair` on and the profile not paused: the first failure in the window only observes (an in-progress hand edit must not trigger a disable); the second attributes and heals. Unattributable failures annotate the incident with `could not be attributed` and never disable anything; every heal lands in the journal and the incident evidence.

A crash after startup (`started: true`) is never self-healed — that path is a process problem, not a plugin-row problem, and the existing process-crash incident owns it.

## Alternatives considered

Acting on the first failure was rejected: a transient state (the user mid-edit in `cordis.patch.yml`) would disable a healthy plugin. Disabling by plugin NAME via the composed dump was rejected: the audit lines spell names, but names are not unique ownership keys the way row ids are, and a name that resolves to no owned row would silently do nothing. Writing through the full repair transaction (`createCandidateTransaction`) was rejected for this lane: the override is a two-line append with a parse gate and idempotence, lighter than the snapshot-stage-gate-promote pipeline, and it reuses the exact persistence mechanism the loader itself already uses for self-disposing plugins. Waiting on the upstream proposal (per-entry `continueOnError`, now [deepseek-harness discussion #5335](https://github.com/deepseek-ai/deepseek-harness/discussions/5335)) remains the long-term fix at the platform level; self-heal is the recovery net for the rows that will keep failing until then.

## Consequences

The recovery window for a row-attributable boot failure shrinks from "user reads logs and hand-edits YAML" to "restart `dsh web` once". The known cost: a self-healed row stays disabled until a user (or a future confirm flow) re-enables it — by design, because silent re-enabling would reintroduce the boot loop. `autoRepair: false` deployments keep today's behavior entirely. The attribution parser is coupled to the host's error wording; if the host changes its boot-error format, attribution degrades to "no match" (safe direction — no disable), and the traces live in incident evidence for re-matching.

## Testing

`packages/dsh-doctor/tests/core-boot-attribution.spec.ts` (7): all four message shapes, the nested same-line form, unknown rows, noise, and non-owned rows. `tests/core-plugin-quarantine.spec.ts` (9): write/idempotence/prefix-confusion/trailing-newline, plus the skip lanes (unowned row, unparseable, empty, already). `tests/agent-supervisor-selfheal.spec.ts` (4): the full closed loop through the real Supervisor — first failure observes only, second attributes and disables exactly the culprit row (i18n row untouched), unattributed failures leave the patch untouched, pause/`autoRepair: false` stay silent, and `started: true` crashes never trigger the lane. `packages/dsh-doctor` full suite 389/389 and `tsc --noEmit` pass. Supervisor-layer change: takes effect on the next supervisor service restart (`dsh-doctor service-install`), no host restart needed.