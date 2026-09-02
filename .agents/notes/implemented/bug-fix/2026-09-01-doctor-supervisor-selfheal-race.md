# Agent Note: Doctor Supervisor Self-Heal Timing and Settling Resilience

Status: implemented

## Problem

In CI under loaded environments, `packages/dsh-doctor/tests/agent-supervisor-selfheal.spec.ts` failed intermittently on `expect(patch).toContain('# dsh-doctor')`. Because `selfHealBootFailure` in `DoctorSupervisor` was invoked as a detached background promise (`void`), a static `150ms` delay in `settle()` was insufficient on slower CI runners, causing the assertion to run before file writes completed.

## Decision

1. In `DoctorSupervisor` (`packages/dsh-doctor/src/agent/supervisor.ts`), track `lastSelfHeal: Promise<void> | undefined` when self-healing is triggered.
2. In `tests/agent-supervisor-selfheal.spec.ts`, updated `settle()` to await `supervisor.lastSelfHeal` and poll `cordis.patch.yml` until expected text appears.

## Consequences

Self-heal boot failure tests settle deterministically across both local and loaded CI environments without fixed timeout race conditions.

## Testing

`pnpm --filter @linxin666/dsh-doctor test` (43 files, 389 tests passed), full `pnpm test`, `pnpm typecheck`, `pnpm docs:check`, `pnpm i18n:check`, `pnpm test:scripts` (234 passed).
