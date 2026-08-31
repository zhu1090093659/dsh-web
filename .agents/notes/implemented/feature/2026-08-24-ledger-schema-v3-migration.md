---
status: implemented
date: 2026-08-24
issue: anrenlx/dsh-web-ui#2
---

# Ledger schema v3 migration (issue #2)

Implemented the Host ledger schema v2 to v3 migration mechanism required as the foundation for continuation-card extension fields (ADR 0001 risk 2).

## Decision

- Bumped `TASK_BOARD_SCHEMA_VERSION` to 3 and introduced `TASK_BOARD_LEGACY_SCHEMA_VERSION = 2` in `protocol.ts`; `host-service.ts` now derives snapshot `schemaVersion` from the constant instead of the literal 2.
- `HostTaskLedger.load()` was split into three explicit paths: legacy migration (v2), normalization (v3), and corrupt recovery (rename to `.corrupt-*` plus empty start). Migration reuses the v3 normalization but first proves every task row passes `isTaskRecord`, so a v2 document that would silently drop or coerce rows fails loudly instead.
- Migration failure fails closed: the constructor throws with the original file path, the file is left untouched (no quarantine, no silent empty restart). A successful migration is persisted immediately as v3 by the constructor's startup `commit(false)` (revision not bumped; a recomputed enabled cron schedule still bumps as before, which is existing repair behavior, not migration drift).
- The ledger file name stays `ledger-v2.json` (plus lock/sidecar names): renaming paths would add migration risk outside this ticket's scope and break the lock-ownership semantics for no functional gain.
- Unsupported future schema versions keep the existing corrupt-quarantine path; only v2 is migrated.

## Alternatives considered

- Inline v2→v3 conversion inside `load()` without a dedicated migration function — rejected: the three-path structure keeps migration, normalization, and corruption recovery independently testable at the existing test seam (`tests/host-ledger.spec.ts`).
- Renaming the file to `ledger-v3.json` — rejected for this ticket (see decision above); listed as a leftover decision in the implementation report.

## Verification

`pnpm --filter @linxin666/dsh-client-ui-task-board typecheck/test/build` all pass (30 ledger tests including 5 new migration cases: lossless v2 to v3 with write-back, empty v3 cold start + reload, loud migration failure with file preservation, future-schema quarantine, and v3 round-trip). `pnpm docs:check` passes after README pair updates.
