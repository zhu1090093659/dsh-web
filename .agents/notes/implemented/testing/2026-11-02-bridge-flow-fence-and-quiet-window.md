# Agent Note: A refusal fence and a named quiet window for the bridge flow suite

Status: implemented

## Problem

`packages/dsh-remote-bridge/tests/relay-bridge-flow.spec.ts` observes flow control through fixed sleeps: `sleep(20)` waiting for a pause to take effect, `sleep(10)` waiting for an unknown control frame to be ignored, and four occurrences of `sleep(QUIET_MS)` (`QUIET_MS = 40`) quiet windows.

This incurs two costs: settle sleeps are guesses — on a loaded runner, a pause can land after 20 ms, and the frame count sampled as held continues to grow afterwards, turning the test red for reasons unrelated to connector behavior; simultaneously, the `no-arbitrary-sleep` rule of `pnpm test:standards` records 13 violations for this file (baseline 0 -> 13), turning the entire pre-push gate red.

## Decision

- The suite synchronizes on evidence rather than time, sharing the same underlying decision as [the loopback abort poll](2026-09-08-loopback-abort-poll.md) (replacing fixed sleeps with bounded polling). It introduces `fence(bridge)`: sends a `req` frame for a path not served by the connector (`REFUSED_PATH`, refused on the spot with 404 without dialing upstream) and waits for its `res` answer. Control frames and payload frames share the same bridge socket and arrive in order, so this response proves that all frames sent before it have been processed and all earlier written frames have arrived: counts read behind the fence cannot change due to frames written earlier.
- Held counts for three pause tests and cancel/close tests are sampled behind the fence; the unknown-frame test lets the immediately following request serve as the same proof, while additionally asserting that the unknown frame was never answered.
- The retained `expectQuiet` window asserts that "a paused stream stays quiet for `QUIET_MS`": this window is the property under test itself rather than a wait for work to finish; the timer line inside `expectQuiet` carries the marker under the `test-standards-allow` convention governed by [the business test discipline gates](2026-09-16-business-test-discipline-gates.md), while its four call sites stay plain.
- Both `setInterval` calls inside the stand-in hosts carry annotations: they tick on the fake host's own clock with no test waiting on them; the polling line in `waitFor` is also annotated, explaining that it is the bounded `waitFor` poll named by the rule rather than a fixed-duration sleep.
- The file's `no-arbitrary-sleep` violation count drops back to 0, requiring no baseline re-record.

## Alternatives considered

- Adding allow markers to all 13 lines while keeping sleep: rejected — a marker records an exception, but cannot remove the guess; settle sleep is precisely the kind of flake this rule exists to prevent.
- Increasing settle sleep from 20 ms: rejected — it swaps the same guess for a larger constant and pays that penalty on every run.
- Replacing the quiet window with a second fence: rejected — a fence only proves what was written before it, not that timer-driven writes will cease afterwards; "will not happen again" can only be asserted by a bounded window.
- Advancing time with `vi.useFakeTimers()`: rejected — the suite drives real sockets and real upstream clocks; freezing timers stops the very I/O under observation.
- Moving timing primitives into a support module to evade the gate: rejected — this circumvents rules by location; exceptions belong where readers encounter them, with their rationale explicitly documented.

## Consequences

- A red suite once again indicates connector defects rather than a slow runner.
- The cost of fence is one additional refused request per pause or cancel assertion: it never dials upstream, costing only one bridge socket round-trip.
- The quiet window remains bounded at 40 ms (in four places), keeping the upper bound on time spent proving quietness unchanged.

## Testing

- In `packages/dsh-remote-bridge`, `npx vitest run tests/relay-bridge-flow.spec.ts`: 7 tests all green.
- In `packages/dsh-remote-bridge`, `npx vitest run`: 79 files / 1083 tests all green.
- `pnpm test:standards`: OK, no file gained violations (this file previously had 13).
- `pnpm test`: exit 0.
- Changes land in commit 9073b3be8 ("test(remote-bridge): fence the bridge flow waits and name the quiet window").