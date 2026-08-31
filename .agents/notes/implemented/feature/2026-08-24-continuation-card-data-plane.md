# Agent Note: continuation-card data plane (issue #4)

Status: implemented

## Problem

ADR 0001's continuation card needs a first full vertical slice: the board must be able to create cards carrying a frozen context snapshot (goal/progress/next), persist it in the v3 ledger, and show/search/archive/restore those cards like plain tasks. The in-session freeze-write entry (a session producing the freeze block) is explicitly out of scope; this ticket is the data plane only.

## Decision

- `TaskRecord` gained an optional `freeze?: TaskFreeze` (`goal/progress/next/frozenAt/redacted?`). `NewTaskInput.freeze` carries the sanitized snapshot; the create and update use cases stamp `frozenAt` from their `now` clock via the shared `freezeOf` helper.
- `sanitizeFreezeSnapshot` in `core/freeze-snapshot.ts` exposes the T2 gates for structured payloads: exact key check, string fields, slash-command taint rejection, sensitive redaction (idempotent), and the 8 KiB per-field byte cap. `parseFreezeRequest` stays the free-text entry; both share the same gate functions.
- `protocol.ts` accepts `freeze` on `create` inputs and `update` patches (update uses `null` to clear, because JSON drops `undefined` keys over the wire). The gate runs in the envelope parser and the sanitized snapshot replaces the wire value in place, so the Host ledger only ever stores gated text.
- `store.ts` re-normalizes `freeze` on every ledger read (import and disk): a malformed or tainted snapshot drops the snapshot alone, never the task row, mirroring the schedule repair policy.
- The UI adds an optional freeze-block textarea in the new-task modal (parsed client-side by `parseFreezeRequest`; a malformed block blocks submission), a frozen badge on cards, a snapshot section with freeze time and redaction warning in the detail view, and search coverage over the snapshot text.
- `matchesFilter` in `TaskBoard.tsx` is exported for tests.

## Alternatives considered

- Storing the raw freeze block text and parsing at read time — rejected: the ledger would persist ungated text and every reader would re-run the parser; gating once at the write seam keeps the stored form authoritative.
- A separate card kind/type field — rejected for this ticket: `freeze` presence already distinguishes continuation cards; a kind union would grow the schema without new behavior.
- Clearing the snapshot with `undefined` in the update patch — rejected: JSON serialization drops undefined keys, so the clear would never survive the HTTP wire; `null` round-trips.

## Consequences

- `frozenAt` is stamped by the create/update use case clock, not the client, so freeze times are Host-consistent.
- The `redacted` flag is advisory copy in the UI, not a trust boundary; the redaction itself already happened at write time.
- The in-session freeze generation entry (agents producing `<<<FREEZE` blocks into a card) remains open and is the natural next ticket, together with the ADR 0001 handover bundle.
- Ledger import (`import` action) accepts freeze snapshots through the same normalization, so imported v1 browser backups can already carry them.

## Verification

`pnpm --filter @linxin666/dsh-client-ui-task-board typecheck/test/build` pass. New `tests/continuation-card.spec.ts` (9 tests) covers the protocol gate (in-place redaction, slash rejection, byte cap, shape), the vertical action -> controller -> ledger -> disk read-back chain, update/clear, archive/restore parity, and filter coverage of snapshot text; the full suite stays at 253 passed.
