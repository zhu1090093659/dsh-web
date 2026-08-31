---
status: implemented
date: 2026-08-24
issue: anrenlx/dsh-web-ui#6
---

# Agent Note: claim provenance wrap and source audit (issue #6)

Status: implemented

## Problem

ADR 0001 adversarial scenario c: frozen card text is stored prompt input that executes later in a fresh session, so a stored prompt injection can ride the card instruction into an unwary picking-up agent. The board also had no audit answer to "which session authored this freeze / which session claimed this card".

## Decision

- `src/host-runner.ts` exports `promptText(task)`: a continuation card (a task with a `freeze` snapshot) has its instruction mandatorily wrapped in a source declaration — freeze instant (ISO), source session (`freeze.frozenBy`, "未记录" when absent), and an unreviewed-content warning — between explicit 开始/结束 markers. The wrap composes with the T4 handover preamble instead of conflicting: the reference preamble comes first, the provenance wrap then encloses the instruction. Plain tasks (no freeze) keep the bare preamble + prompt; the template is board-owned, and card-controlled text (prompt/title body and `frozenBy`) passes through `escapeProvenanceDelimiter`, which neutralizes forged 开始/结束 marker strings so card text cannot close the wrap early (review hardening, see `2026-08-24-review-hardening.md`).
- Provenance stamps: `TaskFreeze.frozenBy` (authoring session) and `ExecutionRecord.initiatedBy` (claiming session) plus a captured copy of the freeze provenance (`frozenAt`/`frozenBy`) on each opened execution. `startExecution` captures the snapshot provenance so later snapshot replacement cannot rewrite history.
- The action envelope gains an optional `initiator` session id (bounded non-empty string, 256 cap; malformed values reject the envelope). The Host ledger stamps it into `freeze.frozenBy` on create, re-stamps on snapshot replacement via update (a swapped freeze cannot keep the old author), and records it as `initiatedBy` on run/rerun; cron-opened runs carry no initiator. The initiator is client-asserted audit metadata, not a trust boundary — the loopback/origin fence in `host-routes.ts` stays the authority check.
- The freeze protocol gate (`sanitizeFreezeSnapshot` extras) passes an optional string `frozenBy` through and rejects non-string values; ledger/store normalization (`parseLedger`, import whitelist) round-trips `frozenBy` and the execution audit fields with type checks, dropping only the malformed field per the existing repair policy.
- `BoardController` passes the current session id (`sessions.list` snapshot) as the initiator for run/rerun through `TaskBoardTransport.action(action, initiator?)`; `HttpTaskBoardHostTransport` carries it on the envelope. The task detail shows the freeze source session (`detail.freeze.frozenBy`) and each execution row shows its initiator (`detail.execution.initiator`), both bilingual.

## Alternatives considered

- Wrapping every card (including plain tasks) — rejected: the threat is stored frozen text executing later; plain-task prompts are authored directly in the board UI, and an always-on wrap would add noise to every ordinary run while the template's freeze provenance fields would be meaningless.
- Trusting the initiator as authority — rejected: it arrives on the same wire as the action; recording it for audit does not widen any permission. The permission confirmation gate (issue #5) remains the execution authority.
- Wrapping the freeze snapshot fields (goal/progress/next) too — deferred: they ride inside the wrapped instruction's card context and are already taint-gated (slash commands rejected, secrets redacted) by the T2 parser; wrapping them again duplicates the same template per field.

## Consequences

- The declaration template's exact wording is a prompt contract; changing it later is safe (Host-owned, no persisted copy) but should stay in one place (`promptText`).
- `initiatedBy` is absent for cron-triggered runs by design; audit consumers treat absent as "scheduler".
- Execution provenance capture snapshots the freeze at open time; if the snapshot is replaced afterwards, the execution still shows the provenance it ran under.
- Browser-originated runs carry the current session id from the Web GUI; the loopback HTTP path from an agent session can assert its own session id the same way.

## Verification

`pnpm --filter @linxin666/dsh-client-ui-task-board typecheck/test/build` pass (285 tests; new `tests/claim-runner.spec.ts` covers the mandatory wrap, the preamble composition order, and the plain-task passthrough; `tests/claim-provenance.spec.ts` covers the envelope initiator gate, frozenBy weaving/re-stamping, execution audit capture, cron absence, store round-trip, and the controller initiator pass-through; `tests/claim-ui.spec.tsx` covers the detail-view audit fields). `pnpm docs:check` passes after the README pair update.
