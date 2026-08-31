---
status: implemented
date: 2026-08-24
issue: anrenlx/dsh-web-ui#1
---

# Agent Note: code-review hardening — import confirmation-gate bypass and provenance delimiter forgery

Status: implemented

## Problem

The two-axis review of `82a9bb45...6621323a` found two adversarial holes in the shipped security patches:

- CRITICAL (scenario b): `importedTask` in `protocol.ts` passed `permissionConfirmedAt` through verbatim, so a crafted `dsh.taskBoard.v1` import (or a wire `import` action) carrying `handover.permission: "danger-full-access"` plus a forged confirmation stamp landed as an already-confirmed elevated card — `run`/`rerun`/cron all allowed it, fully bypassing the T4 confirm-permission gate.
- HIGH (scenario c): `promptText` in `host-runner.ts` wrapped frozen-card text between plain-text `来源声明 开始/结束` delimiters, but the card-controlled body (prompt/title) and `freeze.frozenBy` were not escaped — embedding `来源声明 结束` in card text closed the unreviewed-content wrap early, letting injected content escape the warning context.

## Decision

- `importedTask` no longer carries `permissionConfirmedAt`: the field is dropped unconditionally on import. Import is not a human confirmation action, so an elevated binding re-arms the gate (`requiresPermissionConfirmation` returns true after import until `confirm-permission` runs). The behavior lives in `protocol.ts` with a comment tying it to adversarial scenario b.
- `promptText` funnels card-controlled strings (`body`, `freeze.frozenBy`) through `escapeProvenanceDelimiter`, which replaces the space in `来源声明 开始` / `来源声明 结束` with an interpunct (`来源声明·开始` / `来源声明·结束`). Content stays readable, but the real delimiters can no longer be counterfeited; the template's own closing marker is the only literal occurrence in the emitted prompt.
- Trivial hygiene: `src/core/freeze-snapshot.ts` gained its missing trailing newline.

## Alternatives considered

- Rejecting imports that carry a `permissionConfirmedAt` outright — rejected: stripping is strictly safer for availability (legacy exports round-trip) and equally safe for the gate; rejection would break browser export/import for no security gain.
- Escaping by unicode-escaping every CJK character in card text — rejected: destroys readability of legitimate content; a targeted delimiter neutralization removes exactly the forgery capability.
- Dropping `frozenBy`/`initiatedBy` on import as well (review finding H2) — deferred to a spec-level ticket: those fields are documented as client-asserted audit metadata, not a trust boundary; making provenance trustworthy requires Host-signed attribution (spec change first).

## Consequences

- Re-importing an exported board loses confirmation stamps on elevated cards; the human re-confirms once per card. This is the intended cost of closing the bypass.
- The provenance template remains a Host-owned prompt contract in one place (`promptText`); the interpunct forms are render-only, nothing persisted changes.
- Open follow-ups tracked as new tickets: trustworthy provenance (H2, spec change) and the legacy local-mode `confirmPermission` path (H3, medium).

## Verification

TDD red-green: both adversarial tests were written first and failed against the shipped code (RED), then passed after the fix. `pnpm --filter @linxin666/dsh-client-ui-task-board typecheck/test/build` pass (287 tests; `tests/continuation-card.spec.ts` covers the stamp strip + gate re-arm, `tests/claim-runner.spec.ts` covers delimiter neutralization and injection remaining inside the wrap). `pnpm docs:check` passes. Affected facts in `2026-08-24-handover-confirmation-gate(.zh).md` and `2026-08-24-claim-provenance-wrap(.zh).md` updated in the same change.
