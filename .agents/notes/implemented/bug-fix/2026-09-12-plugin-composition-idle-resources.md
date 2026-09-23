# Agent Note: Idle resources in plugin combinations

Status: implemented

## Problem

The [shared observer](2026-09-11-combined-plugin-mutation-cost.md) reduces native observers, but all current family subscribers ignore the collected mutation records. A paused animation-frame queue still retains every record and its removed subtrees. Last-unsubscribe disconnects the observer without cancelling that frame. With six subscribers and 1,000 subtree replacements, three baseline runs each retain 1,001 records and one queued callback after disposal.

The [shared panel mount](../../implemented/simplification/2026-09-02-panel-mount-core-extraction.md) creates SSH and Task Board React roots before either panel is opened. SSH's default Hosts tab consequently queries its data during page startup. A visited Tunnels tab keeps polling every five seconds after the panel closes or the page is hidden, and slow polls can overlap. The aggregate shim also schedules a second animation frame from a callback already coalesced by the shared hub.

## Decision

- `subscribeBodyInvalidations` wraps callbacks with a cross-bundle symbol marker. When every listener uses this API, the existing hub schedules one re-check and retains no records. `subscribeBodyMutations` continues delivering complete records to consumers that need them; mixed subscriptions keep that contract. Generated copies remain compatible with an older hub, although the older hub continues collecting records until a reload loads the new implementation.
- The last record consumer's departure releases queued records. Last-unsubscribe cancels the hub's frame as well as disconnecting its observer. A listener removed by an earlier callback is skipped in that flush.
- The panel mount creates its lightweight container immediately and creates its React root on first open. Visited roots stay mounted across close/reopen, preserving drafts, selected tabs and terminal sessions. A detached closed tree is released and its replacement waits for opening. Task Board's controller and Host synchronization retain their existing lifecycle.
- SSH passes its controller's open state to the Tunnels tab. Automatic reads run only while both the panel and document are visible, refresh immediately on return, and allow one automatic request in flight. If a request is still pending across close/reopen, one deferred refresh runs after it settles; repeated toggles replace that refresh instead of accumulating requests. Cleanup invalidates late responses without stopping Host tunnels, user-requested operations or terminal sessions.
- The aggregate shim performs its idempotent pass directly in the hub callback. This removes the second frame and its stale work after disposal. Whole-frame semantic queries remain unchanged; their incremental rewrite was considered and declined in the earlier note.

## Measurements

The [resource-count benchmark](../../../../docs/archive/2026-09-12-plugin-composition-bench.mjs) loads the actual TypeScript scheduling and mount code from a Git ref or the working tree, using jsdom and React. Translation, CSS and SSH responses are fixtures. Paused frames and twelve five-second ticks are controlled; this measures resource counts, not CPU time, heap bytes or end-to-end frame rate.

```sh
node docs/archive/2026-09-12-plugin-composition-bench.mjs --ref 78681d3c
node docs/archive/2026-09-12-plugin-composition-bench.mjs
```

Each command performs three runs. All three runs agree with the medians below. Raw results are retained in the [measurement snapshot](../../../../docs/archive/2026-09-12-plugin-composition-measurements.json).

| Metric | Before | After |
| --- | --- | --- |
| Retained mutation records, six invalidation consumers and 1,000 subtree replacements | 1,001 | 0 |
| Queued hub frames after last-unsubscribe | 1 | 0 |
| Initial React renders for two unopened panels | 2 | 0 |
| Frames until a new code block receives its responsive hook | 2 | 1 |
| Automatic tunnel reads per hidden minute, closed panel | 12 | 0 |
| Automatic tunnel reads per hidden minute, hidden document | 12 | 0 |
| Tunnel intervals after unmount | 0 | 0 |

## Alternatives considered

Dropping mutation records from the existing API would silently break record consumers. A separate invalidation API preserves their behavior and lets separately bundled copies share the existing hub.

Disconnecting the body observer whenever the document is hidden would require visibility listeners and a separate full-refresh signal to avoid missing shell replacements. Record-free invalidations retain one pending re-check and observe normally, without retaining detached subtrees.

Unmounting every panel whenever it closes would release more memory, but it would discard local drafts and interrupt terminal components. First-open rendering avoids work for unused plugins while retaining the existing state lifecycle for visited panels.

Slowing every tunnel poll would reduce traffic at the expense of visible freshness. Visibility gating keeps the five-second interval and an immediate refresh on return.

## Consequences

First-open rendering moves the initial work to the first click; it does not eliminate that work for panels the user uses. Visited closed panels retain their React state and subscriptions intentionally. Task Board's Host scheduler and synchronization, SSH connections and forwarding are unchanged.

The hub checks listener markers per mutation callback, an added scan over the small subscriber set. Record consumers still retain their requested records until the next frame. If an older bundle creates the hub first, invalidation-only subscribers keep working but do not receive the retention improvement until the new hub is loaded.

The aggregate client grows from 2,926,084 to 2,931,248 bytes; gzip grows from 822,867 to 824,072 bytes, an additional 1,205 bytes. No FPS or process-memory percentage is claimed from the resource-count benchmark.

Source changes require rebuilding the affected client packages and the aggregate, which embeds child sources. No bundle rows, defaults, dependency versions, profile settings or DSH source files change.

## Testing

Regression coverage includes record delivery with mixed subscribers, separately evaluated bundles, old-hub compatibility, frame cancellation, listener removal during dispatch, absent animation-frame support, first-open mounting, draft retention, sibling-panel eviction, delayed shell arrival, detached-tree recovery, hidden polling, immediate resume, slow requests, stale responses and bounded refreshes across repeated close/reopen.

Repository typecheck, package tests, all 274 script tests, documentation, i18n, shared-copy consistency, aggregate consistency and runtime-dependency checks pass. The four affected client packages, including the aggregate, build successfully.

One parallel package-test run fails the existing abort-timing assertion in `dsh-remote-web-ui/tests/loopback-proxy.spec.ts:108`. That package and the shared proxy source have no changes in this task. A focused rerun passes all three proxy cases, and the complete suite then passes with `pnpm --workspace-concurrency=1 -r test`; no proxy code or test expectation is changed.

The real GUI at `http://127.0.0.1:3080/` is exercised at 1600 × 1000 and 390 × 844 using an isolated browser that replaces only the aggregate client response with the new build. The service, profile and running processes remain untouched. Desktop first-open, close/reopen, filter-text preservation and input-node identity pass; the unopened board has zero child nodes. Both baseline and modified builds have zero page errors and failed script/style loads.

Narrow-screen acceptance remains limited by an existing layout problem in the running combination: both builds place the back button at y=854 outside the 844 px viewport, including when the sidebar is collapsed. Baseline and modified screenshots confirm the same failure, so mobile navigation is not reported as passing. SSH polling is verified through its actual component and controller tests; the live profile does not exercise a remote SSH session. Live GUI checks use response replacement and do not prove that an existing browser has loaded the delivered artifact.
