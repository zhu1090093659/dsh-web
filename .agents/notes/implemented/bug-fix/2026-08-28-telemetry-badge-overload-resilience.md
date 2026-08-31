# Agent Note: Telemetry users badge stays servable under D1 overload

Status: implemented

## Problem

The README "users" shields endpoint badge rendered "inaccessible". Two independent failure layers stacked up on `/api/telemetry/badge/users`:

1. **Slow compute.** The badge answered with a live `COUNT(DISTINCT visitor)` over `telemetry_events` (~1.1M heartbeat rows, ~86k distinct visitors). A production `wrangler tail` captured shields' own fetcher (UA `Shields.io/080e177`) aborting every request at a wall time of ~3450 ms — shields' upstream fetch timeout is ~3.5 s. Each aborted invocation was killed before it could cache anything, so every shields fetch landed on a cold path again: the badge could never succeed through shields regardless of database health.
2. **D1 overload.** During overload windows the query failed outright with `D1_ERROR: D1 DB is overloaded. Requests queued for too long.`, the worker died with an unhandled exception, and shields received the Cloudflare 1101 error page (HTTP 500). The same tail captured hundreds of failing requests in ten minutes of production traffic, including the badge, `/api/stats` reads and telemetry writes.

## Decision

- A new `badge_cache` D1 table (migration `0005_badge_cache.sql`) holds precomputed counts as single rows. A cron trigger (`*/30 * * * *` in `market/worker/wrangler.jsonc`, `scheduled` handler in `market/worker/src/index.js`) recomputes the heartbeat distinct-visitor count into the table every 30 minutes.
- `handleTelemetryUsersBadge` (`market/worker/src/telemetry.js`) now reads that single indexed row — fast enough for shields' timeout from any colo — and keeps the 30-minute edge Cache API entry plus a 24-hour stale copy on top. Before the first cron tick (or if the row is missing) it bootstraps by running the scan once and seeding the row. On any D1 failure it serves the stale copy, or a valid `{"schemaVersion":1,...,"message":"unavailable"}` 200 JSON. No code path can produce a 5xx or exceed shields' timeout by serving a slow first byte.
- `handleTelemetryPost` catches D1 write errors and returns `503 {"ok":false,"error":"storage-unavailable"}` — the same shape as the existing missing-binding branch — instead of an unhandled exception page. Clients treat non-acceptance as "retry on the next mount", matching the documented fire-and-forget contract in docs/telemetry.md.
- `/api/stats` (market/worker/src/index.js) gained the same edge-cache pattern (60 s fresh, 1 h stale copy) plus a 503 `storage-unavailable` fallback: workshop cards fetch it on every GUI start, and the card UI already treats non-200 as its zero state. `/api/telemetry/summary` returns the same 503 JSON instead of an exception page; it is deliberately NOT edge-cached because the cache key cannot carry the `x-telemetry-key` authorization.
- Retention pruning moved off the summary read path into the cron trigger, so dashboard reads no longer issue opportunistic DELETEs against an overloaded D1.
- The public contract text gained the same facts: docs/telemetry.md (badge bullet, client retry paragraph, prune sentence), the api-doc.js endpoint table (badge precompute, stats and summary 503) and the OpenAPI summaries.

## Testing

Local `wrangler dev --test-scheduled` with local D1: the cron trigger rewrites a deliberately corrupted row value back to the real count; the badge serves the row in ~10 ms; deleting the row makes the next request bootstrap through the full scan and re-seed; dropping `telemetry_events` with an emptied cache yields the 200 "unavailable" JSON; POST with the table dropped returns the 503 JSON. `/api/stats` serves counts, keeps serving them from the stale copy after its table is dropped, and returns the 503 JSON when there is no cached copy; `/api/telemetry/summary` returns 503 JSON with `telemetry_events` dropped; the cron runs clean with both tables missing. Production `wrangler tail` after deploy shows the `Shields.io/080e177` fetcher completing with outcome "ok" well under the 3.5 s timeout, and the shields badge renders the real count.

## Alternatives considered

- Maintaining a counter incremented on every heartbeat insert instead of a cron recomputation: avoids the periodic scan but adds write-path cost and complexity to every event insert for a number that moves slowly. The cron scan (one query per 30 minutes) is simpler and self-healing.
- Serving stale-while-revalidate from the edge cache alone: cold colos still run the slow scan, and shields' abort kills the invocation before anything is cached, so the badge never recovers through shields. Declined.
- Adjusting only the shields-side `cacheSeconds`: the timeout, not the cache, was the binding constraint. Declined.
- Sampling or rate-limiting heartbeat writes to reduce D1 load: a telemetry-architecture decision (cadence, aggregation, storage tier) that deserves its own proposal; this change makes the badge and the write path resilient regardless.

## Consequences

- The badge shows a count at most ~1 hour old (30 min cron + 30 min edge cache); acceptable for an all-time cumulative number.
- If D1 stays unavailable past the last computed row and both cache copies expire, the badge shows the grey "unavailable" state rather than a number.
- During overloads telemetry senders receive 503 responses and retry on the next mount; retry volume is bounded by one pending day per browser.
