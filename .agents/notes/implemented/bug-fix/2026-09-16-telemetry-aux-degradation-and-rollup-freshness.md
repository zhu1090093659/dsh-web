# Agent Note: Telemetry summary degrades auxiliary scans and stamps rollup freshness

Status: implemented

## Problem

tv.dsh-market.com appeared to lose 2026-09-14 and 2026-09-15. The raw days were never lost — D1 holds 158,721 and 151,707 heartbeat rows for them — but every summary recompute failed from 2026-09-14 01:01 UTC until 2026-09-16 00:01 UTC (the 01:30 UTC cron tick logged `D1_ERROR: out of memory: SQLITE_NOMEM` for the 30/365-day windows while D1 simultaneously rejected small relay writes as overloaded), so `handleTelemetrySummary` served its stale-fallback rollup computed 2026-09-13 06:07 UTC. The dashboard's only freshness signal was the client fetch time, so a three-day-old rollup read as "lost days" instead of a lagging cache.

Measured against production during the incident: the 30-day heartbeat day-series costs 4.2s over 4.3M index rows, the channel grouping 11.3s, the item page 12.2s, and the version grouping fails outright (Cloudflare internal error 7500) even standalone via the HTTP API. At ~150k rows/day growth every window degrades further, exactly as [the rollup-cache note](2026-09-01-telemetry-summary-rollup-cache.md) predicted for 90/365 days; 30 days joined them.

## Decision

- The channel/version breakdowns are auxiliary and now fail soft: each runs as its own single-statement batch, and when its COUNT(DISTINCT) scan fails (SQLITE_NOMEM), `telemetrySummary` logs `[summary-aux] <label> skipped`, returns an empty breakdown and flags the payload with `degraded: ["channels" | "versions"]`. The daily series, item page, totals and today-activity stay exact; if one of those scans fails, the whole window still falls back to the stale rollup as before.
- Every summary payload carries `generated_at` (epoch ms of the rollup compute; cache reads keep the original stamp, so the fallback's age is visible). The dashboard renders the stamp ("数据滚存于") next to the fetch time, warns when the rollup is older than twice its TTL (one hour for windows up to 30 days, 24 hours beyond) and lists skipped breakdowns — a frozen rollup can no longer masquerade as missing data.
- The nine aggregates now run as five D1 batches (was four): one light chunk (pv day-series, hb day-series, top paths, paths total, today's items) plus one statement per chunk for channels, item page, item totals and versions. [The per-day rollup pipeline](2026-09-20-telemetry-daily-rollup-pipeline.md) supersedes that shape: the summary reads the rollup tables in three batches, and the fail-soft path stays for the auxiliary breakdowns.

## Testing

`scripts/market-worker.test.mjs`: batch-shape assertions updated (one light chunk of five plus four single-statement chunks); new tests pin that a failing versions/channel scan answers 200 with the breakdown empty, `degraded` flagged in payload and cached rollup, sibling breakdown and daily series intact; `generated_at` present in payload and cache row. `scripts/telemetry-view.test.mjs`: shell carries the `generated` stamp and `stale-warn` elements and the client renders freshness state. Deployment evidence: both workers redeployed (dsh-market `92e28a74`, dsh-market-telemetry-view `4ce2ae4a`); the next cron ticks refreshed the 30-day first-paint rollup with `degraded: ["versions"]` and the dashboard showed 09-14/09-15 again.

## Alternatives considered

- Splitting the heavy statements further or retrying them: the version scan fails standalone, so no batching shape recovers it; only a cheaper query shape would.
- The per-subject fact table (the 2026-09-01 note's deferred end-state): still the durable fix for exact windowed dedup at growing volume, but a write-path redesign with backfill; deferred again because fail-soft restores the dashboard windows today.
- Dropping the 90/365-day windows: unnecessary while the stale fallback plus freshness display degrades them legibly.
- Baking the UTC day into the event id: diagnosis surfaced that `telemetry_events.id` omits the day, so `day` is each (visitor, item, version, channel) combo's first-seen date — not the documented per-day dedup. Changing it would rewrite the meaning of every historical series and multiply row volume; recorded as a caveat for the owner, deliberately not changed here.

## Consequences

- 30-day windows (the dashboard's first paint) recompute again while D1 is under load, at the cost of occasionally empty version distribution; consumers must read `degraded`. [The per-day rollup pipeline](2026-09-20-telemetry-daily-rollup-pipeline.md) lifts that cost out of the read path.
- Degraded payloads are cached for the TTL like any rollup; the flag travels with the cached bytes.
- 90/365-day windows still freeze at their last successful rollup under D1 memory pressure; the freshness stamp now makes that legible instead of silent. The deferred structural step shipped as [the per-day rollup pipeline](2026-09-20-telemetry-daily-rollup-pipeline.md): the aggregation reads per-day rollup tables instead of scanning the event table.
