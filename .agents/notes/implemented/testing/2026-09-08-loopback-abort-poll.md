# Agent Note: poll instead of a fixed sleep for the loopback abort assertion

Status: implemented

## Problem

`packages/dsh-remote-web-ui/tests/loopback-proxy.spec.ts` asserted that an outer-client abort stops the inner request after a fixed 80 ms sleep. The proxy propagates the abort asynchronously, so on a loaded runner the reset can land after that window: the same assertion failed once locally inside `pnpm -r test`, passed 6/6 in isolation, and then turned the CI run for the documentation push red (run 34240029467, `expected false to be true` at line 93). A red suite that depends on runner load trains maintainers to re-run instead of read.

## Decision

- The first test polls for the abort with a bounded `waitFor(predicate, 2000, 10)` helper and asserts the polled result, so the assertion stays strict — a genuine regression still fails once the deadline passes — while the timing stops depending on machine load.
- The other two tests keep their shape: the truncated-response test already waits on the response event, and the keep-alive test waits on the request promise.
- The helper documents why it exists (asynchronous propagation plus loaded runners), so the next reader does not simplify it back into a sleep.

## Alternatives considered

- Raising the fixed sleep (for example 80 ms to 500 ms): rejected — it only moves the threshold, still fails on a slower runner, and slows every run.
- Retrying the whole test on failure: rejected — a retry hides real regressions and doubles the cost of the flaky path.
- Marking the test skipped or loosening the assertion: rejected — abort propagation is the behavior under test; weakening it removes the coverage that caught the race.

## Consequences

- The suite no longer depends on how loaded the runner is, so a red CI run means a real defect again.
- The worst case adds up to two seconds per run when the abort genuinely never arrives; the normal path returns as soon as the flag flips (a few milliseconds).

## Testing

- `pnpm vitest run tests/loopback-proxy.spec.ts` in `packages/dsh-remote-web-ui`: 10 consecutive green runs.
- `pnpm test` twice on the changed tree under the parallel load that originally reproduced the flake: both green, and `pnpm typecheck` green.
- CI run 34240029467 is the failing evidence this fixes; the follow-up CI run on dev is the acceptance check.
