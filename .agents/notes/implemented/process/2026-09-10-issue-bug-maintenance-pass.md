# Agent Note: Bug-issue maintenance pass of 2026-09-10

Status: implemented

## Problem

The repository had ten open issues, eight of them bug reports, all assigned to the same collaborator. The owner asked for a maintenance pass that handles the bug reports only, including those already assigned to a collaborator, and leaves enhancement requests alone.

## Decision

Six bug reports were reproduced, fixed on `dev`, and closed with the verified evidence in each thread:

- #1450 and #1455 (liangshen preset schema and durable message source) — commit `6d2cf827`, [note](../../bug-fix/2026-09-10-preset-schema-and-message-source.md).
- #1458 (scene-resource URL encoding) — commit `16241a86`, [note](../../bug-fix/2026-09-10-scene-resource-url-encoding.md); the renderer-domain collaborator was notified in the issue thread, per the repository rule for that domain.
- #1447 (task-board archive gate) — commit `b0151d32`, [note](../../bug-fix/2026-09-10-task-board-archive-non-running.md).
- #1453 (plugin-manager effective enablement) — commit `7375afad`, [note](../../bug-fix/2026-09-10-plugin-manager-effective-enablement.md).
- #1442 (root alias aggregate pin) — commit `058c981c`, [note](../../bug-fix/2026-09-10-root-alias-exact-aggregate-pin.md).

Both remaining bug reports were closed on the owner's decisions after the pass, each with its verified position recorded in its thread:

- #1452: the crash needs a DSH host below the aggregate's declared floor (`>=0.1.5-rc.1`). Holding `dsh-better-sidebar` back to 0.18.0 would protect below-floor hosts but reverses the same-day [0.1.5-rc.1 cohort decision](../architecture/2026-09-10-sdk-cohort-0.1.5-rc.1.md) and has no rc.1 smoke on the older build, so it was left to the owner. The owner then decided the handling: close it pointing at the host upgrade and keep the cohort pin. The thread now tells reporters to upgrade to the latest DSH (0.1.5-rc.1, the npm `latest` tag) and keeps pinning the aggregate to 0.3.19 as the fallback for hosts that cannot move.
- #1397: root cause is the private `Symbol` registration key inside the official `@deepseek-ai/dsh-tools`, still present at 0.1.5-rc.1, and this repository has no fix site. It was closed on the owner's instruction rather than kept as a local tracker: the thread carries the upstream root cause with line references, the two-line upstream fix (`Symbol(` → `Symbol.for(`), and the local workaround.

The two enhancement issues open at the time (#1439, #1448) were left untouched as out of scope.

## Alternatives considered

- Closing #1452 during the pass as "not reproducible on a supported host". Rejected then: it would have buried the enforcement gap (the host ignores `dsh.engines.dsh`, and only the gateway update path blocks below-floor updates) and pre-empted a product decision; the owner's later instruction supplied that decision, and the closure now states the upgrade requirement explicitly.
- Downgrading `dsh-better-sidebar` to 0.18.0 unilaterally. Rejected: it contradicts the cohort note's explicit rejection of that bump, and the older build was never smoke-tested against rc.1.
- Patching the DSH host or `dsh-tools` for #1397. Rejected: modifying a DSH checkout is outside this repository's bounds and would not survive the next install.
- Keeping #1397 open here purely as an upstream tracker. Rejected by the owner after the pass: there is no repository work item to track, and the thread already carries the root cause, the upstream fix, and the workaround; a fresh issue can be opened when the upstream release lands.

## Consequences

- No bug report remains open; the two open issues are the enhancements that were out of scope.
- Every fix carries its own Agent Note with the verification commands and the rejected alternatives, so the reproduction evidence survives the issue threads.

## Testing

All fixes were delivered through `dev` after the full gate suite: `pnpm typecheck`, `pnpm test`, `pnpm docs:check`, `pnpm i18n:check`, `pnpm aggregate:check`, and `pnpm test:scripts` (272 tests) all pass on commit `058c981c`, which is on `origin/dev`.
