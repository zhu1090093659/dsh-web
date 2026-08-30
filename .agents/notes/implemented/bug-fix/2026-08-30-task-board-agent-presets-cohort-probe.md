# Agent Note: dsh-task-board agent-preset roster probe throws on cohorts that do not expose remote.agentPresets

Status: implemented

## Problem

On every page the client logged `[dsh-task-board] agent preset roster read failed Error: cannot get property "remote.agentPresets" without inject`. `readPresetRoster` (`packages/dsh-task-board/src/client/index.ts`) is meant to be a cohort-safe probe: it reads `remote.agentPresets` when the running host exposes the generated api-remotes face, else falls back to the legacy `connection.api.agentPresets` face, and returns `undefined` when the host serves neither so the caller leaves the agent-preset options untouched instead of erroring. The cordis `remote` service proxy, however, throws on any property that was never injected rather than returning `undefined`, so the bare property read (`(remote as Partial<ClientRemote>).agentPresets`) aborted the probe and pushed the whole roster read into the caller's catch/log path on cohorts below the 0.1.2-alpha.1 cohort.

## Decision

Guard the `remote.agentPresets` read in a `try/catch` and fall back to `undefined` on throw, so the probe degrades exactly as designed — a host that does not expose the face is indistinguishable from one that does, and the caller's "leave options untouched" path runs instead of a console error. The access is the only change; the `ClientRemote['agentPresets']` type is preserved.

## Alternatives considered

- Testing `'agentPresets' in remote` before reading: rejected because the proxy's behavior under the `in` operator is not contractually undefined across cohorts, and a `get` trap that throws is the observed failure mode; the `try/catch` directly neutralizes the throw.
- Adding an `inject` wait for `remote.agentPresets`: rejected — a hard injection wait would pend the board mount forever on hosts below the cohort that only serve the legacy connection face, which is the exact defect the probe was written to avoid.

## Consequences

- The `[dsh-task-board] agent preset roster read failed` console error no longer appears on hosts that do not inject `remote.agentPresets`; the agent-preset mode picker options simply stay unpopulated (degraded) on those hosts, as intended.
- The cohort-safe probe now matches its documented contract.

## Testing

- `pnpm typecheck` (repo): passes, including `packages/dsh-task-board`.
- `pnpm --filter @linxin666/dsh-client-ui-task-board test`: 309 passed, 1 skipped.
