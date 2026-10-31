# Agent Note: GitHub remote close cycles

Status: implemented

This decision partially supersedes [GitHub Issues as Task Board work items with controlled write-back](2026-09-30-task-board-github-issues-integration.md): issue discovery, controlled labels, execution immutability, credentials and PR lifecycle remain owned there, while the bounded inbound close mapping below replaces the earlier choice never to let remote state drive a local column.

## Problem

GitHub synchronization stored each issue's open/closed state but reconciled only newly materialized cards into Done. Existing cards therefore stayed in active columns after their issue closed, while an unconditional remote mirror would risk interrupting a real local execution or overwriting a human's deliberate column choice.

## Decision

The provider owns one explicit close cycle per card through optional `integrations.github.remoteClose` metadata and the board's existing `tasks.setStatus` gate:

- A newly materialized closed issue starts in Done with `auto-done` provenance. An existing non-running, unarchived card moves to Done with initiator `github:remote-close` before that provenance is persisted. No execution record is created, and an existing Done card without provenance remains a manual or legacy completion.
- A running card records `deferred` with its open execution id. The execution-settled entry records the actual `settledStatus` before any network await; a later closed sync moves the card only when its current column still equals that captured column. Missing execution or settlement evidence is conservative and never forces a move.
- Reopening clears the cycle. It moves a card to To Do with `github:remote-reopen` only when the card is still Done with `auto-done` provenance; manual completion, deferral and override states do not reverse a local column.
- Moving an `auto-done` card out of Done changes the next closed reconciliation to `overridden`, which preserves the local column until the issue reopens. A later close starts a new cycle and may auto-complete again.
- Archived cards stay archived and deactivated cards stay hidden. A refused status migration leaves provenance truthful and records `lastSyncError`; a payload failure after a status move rolls that move back so a later sync can retry. Repeated syncs are idempotent and outbound label and PR safety rules do not change.

The marker is normalized inside the provider's opaque payload. It adds no ledger schema version, agent-tool field, Host wire field or GitHub-specific board logic.

## Alternatives considered

**Mirror every remote state directly into all five columns.** Rejected: GitHub cannot represent local execution sessions or permission gates, and a remote edit must never interrupt a running card.

**Always let the latest closed poll win over a local move.** Rejected: it makes an active column unusable for a deliberately reopened local workflow and gives the operator no way to override a stale remote close.

**Infer automatic completion from the current Done column alone.** Rejected: reopening would then move cards a human completed, while a missing execution-settlement event could move a card whose column had already changed again.

## Consequences

- Remote close can settle the visible board without weakening Host authority over running work. Human override is durable for exactly one close cycle, not a permanent hidden flag.
- Existing Done cards are safe by default because only explicit `auto-done` provenance participates in reopen migration.
- Polling and manual refresh keep their existing cadence; this decision adds no webhook, remote close/reopen write, schedule change or execution outcome.

## Testing

`packages/dsh-task-board-github/tests/remote-close.spec.ts` drives the real synchronization service against the contract-level fake board and remote backend: new and existing closed issues, idempotency, manual Done, override and a new close cycle, all three settlement outcomes, manual movement after settlement, reopen before settlement, missing evidence, archived cards and malformed provenance. Existing projection and label-safety suites run with it.
