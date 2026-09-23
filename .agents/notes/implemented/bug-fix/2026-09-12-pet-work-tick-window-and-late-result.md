# Agent Note: Pet Work-Tick Window Follows the Cadence, Late Ticks Are Dropped

Status: implemented

## Problem

Two defects in the pet's work mode:

1. `workTick` at the injected API entry throttled on a hardcoded 8500 ms window
   (`now - lastWorkTickAt < 8500`), while the HUD drives the work loop at the manifest's
   `gameplay.work.tickMs`, whose own validated range is 1000-60000 ms. Any pet configured below
   8.5 s was silently downgraded — with `tickMs: 2000` the adjudication ran roughly once per 10 s —
   and the configuration was overridden without a word (#1494).
2. The work loop's `.then` callback applied its result unconditionally. Leaving work mode while an
   adjudication was in flight still wrote the returned work view back into the store and played the
   success/fail track, so a mode the user had already left briefly reported work rewards (#1495).
   Only the follow-up timer checked the mode; the write-back did not.

## Decision

1. The throttle moved into `src/client/work-tick-gate.ts`. `workTickWindowMs(tickMs)` returns the
   active pet's cadence clamped to the manifest's own `[1000, 60000]` bounds, falling back to 10000 ms
   (the bundled pets' value) when the registry entry is unknown. `createWorkTickGate(now)` keeps the
   original intent — one adjudication per window, page-wide, so hot-reload duplicates cannot replay the
   result — and `reset()` re-arms it when work mode is entered. The fixed 8500 ms constant is gone.
   The client resolves the cadence from the store's registry list and snapshot pet id, so the verb
   signature is unchanged.
2. The work loop's callback returns early unless `modeRef.current === 'work'`, so a late result writes
   neither the view nor the track.

## Verification

- `pnpm --filter @linxin666/dsh-pet test`: 43 files, 511 tests passed. New coverage: the gate module
  (window follows the cadence, clamps, defaults; one adjudication per window; reset re-arms) and a HUD
  case that leaves work mode with the tick RPC pending and asserts the store keeps `mode: null` and no
  success track is played.
- `pnpm --filter @linxin666/dsh-pet typecheck`: passed.

## Alternatives considered

Passing `tickMs` from the HUD into `workTick` was rejected: it changes the verb signature, the
`GameplayApi` interface and every test mock, while the store already carries the registry definition the
window needs.

Removing the throttle entirely was rejected: several HUD instances can survive a hot reload, and without
a shared gate each would adjudicate and replay the result — the exact failure the original comment
described.

Relying on the HUD's `busyRef` alone was rejected: it guards one component instance, not the page.

Adding an explicit "throttled" marker to the verb result, as the report suggested, was rejected: an
`{ ok: true }` without `outcome` is already a no-op in the HUD (no view to write, no track to play), so
the marker would only widen the result type for every caller.

## Consequences

A pet configured with a cadence below 8.5 s now adjudicates that often, and the window always tracks the
pet's own configuration rather than a constant. A very small `tickMs` (the manifest floor is 1000 ms)
means proportionally more host adjudications, which is what the configuration asks for.
