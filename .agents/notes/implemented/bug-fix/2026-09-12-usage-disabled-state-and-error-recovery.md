# Agent Note: Usage Section Recoverable Disabled State

Status: implemented

## Problem

Disabling `@linxin666/dsh-usage` from its own settings section locked the user out of the plugin.
The host's `rearm()` deregisters `/api/dsh-usage/overview` and `/api/dsh-usage/refresh` when
`enabled: false`, but the browser half kept its 10 s poll running against the dead route, so every
tick produced a 404. The failure path replaced that status with the hardcoded string
`usage.overview transport error`, and `UsageSectionCard` opened with
`if (ui.status === 'error') return <div .../>`, a panel-wide return placed *before* the settings row.
The enable checkbox lives in that row, so the only way back was editing `settings.yaml` by hand
(#1500, a regression of #1294).

## Decision

1. The settings row renders in every non-ready state — disabled, failed and still loading — under a
   status line instead of being replaced by it. The enable checkbox therefore stays reachable, and
   ticking it is the recovery path.
2. `enabled` is read from the settings scope the card already receives (`settings.getSnapshot().value`),
   and the card subscribes to that scope so a write re-renders it. While disabled the poll effect
   returns before its first request, so a disabled plugin produces no background traffic at all.
3. Transport failures carry their own message into the store (`usage /api/dsh-usage/overview failed: 404`)
   instead of a fixed string, so a deregistered route is distinguishable from a real fault.
4. New copy key `usage.disabled` (zh/en in the package, ru mirrored in `dsh-i18n`).

## Verification

- `pnpm --filter @linxin666/dsh-usage test`: 8 files, 102 tests passed, including three new cases —
  disabled renders the notice and never calls `poll`, re-enabling calls it once, and the failed
  state keeps the checkbox mounted with the real message.
- `pnpm --filter @linxin666/dsh-usage typecheck`: passed.
- `pnpm i18n:check`: passed (zh/en/ru parity, no CJK outside comments).

## Alternatives considered

Pushing `enabled` to the browser half through a new host field was rejected: the card already holds
the settings scope, so the flag was reachable without widening the host surface.

Keeping the last successful snapshot visible while disabled was rejected: the host has deregistered
the route, so the retained document can only go stale, and showing stale balances is more misleading
than stating that the plugin is off.

Keeping the panel-wide error but adding a dedicated "re-enable" button was rejected: the switch that
caused the state sits in the same panel, and a second control for one boolean invites drift.

## Consequences

A disabled plugin is quiet and recoverable from the UI, and the error line names the real failure.
The disabled notice is new user-visible copy in three languages. The error line still shows the
transport's own (English, technical) message rather than a localized sentence, because the status
code is the actionable part; only the surrounding label is localized.
