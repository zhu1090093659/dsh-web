# Agent Note: Telemetry summary rollup cache and indexed read path

Status: implemented

## Problem

tv.dsh-market.com (the private telemetry dashboard) answered every visit with
"502 — Summary upstream returned 503". The dashboard worker only renders what
`GET /api/telemetry/summary` on the market worker returns, so the market
worker's summary aggregation was failing against D1.

Root cause, measured on the production database: `telemetry_events` had no
secondary index, so each of the nine summary aggregates full-scanned the wide
table — ~2.02M rows / 828 MB after only nine days of telemetry (the feature
shipped 2026-08-24 and gains 130-290k rows/day). The heartbeat-side statements
took 17.7-24.7s each, so the nine-statement `env.DB.batch` transaction exceeded
D1's limits and the handler's catch turned every failure into the contracted
503 `storage-unavailable`. Growth of roughly 7%/day meant any point fix would
re-break within weeks, and the badge cron's full-scan `COUNT(DISTINCT visitor)`
was on the same trajectory (17s and climbing every 30 minutes).

## Decision

Two layers — migration `0006_telemetry_summary_cache.sql` plus worker changes,
applied to production on 2026-09-01:

- Covering index `idx_telemetry_kind_day (kind, day, visitor, subject,
  version, channel)`: every summary aggregate becomes an index-only scan
  (day-series 17.7s -> 0.88s). A standalone `idx_telemetry_day` turns the
  30-minute retention DELETE into a range probe.
- Summary rollup cache `telemetry_summary_cache`, one row per exact query
  window (days + both pagination windows), TTL 30 minutes: a fresh row is
  served directly (~0.05s), an expired row triggers a live recompute and
  re-seed, and when the live aggregation fails the previous row is served
  regardless of age, mirroring the badge's stale fallback.
- The nine aggregates now run as four D1 batches — one light chunk (day
  series, top paths, today's items, channels) plus one single-statement batch
  per heartbeat grouping scan — because even indexed, the batch transaction as
  a whole exceeded D1 limits (a 43.8s cold call failed) while the heaviest
  single statement stays ~14s. Cold compute takes ~34s against production
  data; only the cron and an occasional TTL expiry pay it.
- Cron pre-warm (`refreshSummaryCache`) refreshes the tv first-paint key
  (30d, 10-row pages) every tick plus one rotation slot of the range-button
  windows (7/30/90/365d, default pages): scheduled invocations are killed
  after roughly two minutes, and five ~40s windows per tick die mid-list, so
  each tick carries at most ~80s of work. Pager offsets the owner clicks warm
  on demand, and windows up to 30 days serve with a 30-minute TTL while
  90/365-day windows tolerate 12 hours of staleness.
- All-time badge counting moved to `telemetry_visitors (kind, visitor)`: the
  heartbeat write path upserts the salted visitor hash in the same D1 batch as
  its event rows, the migration backfilled the existing visitors, and the cron
  now counts a ~170k-row primary-key range (0.02s) instead of a full event
  scan.

## Alternatives considered

- Covering index alone: measured insufficient — the unsplit batch still
  exceeded D1 limits and daily growth re-breaks it within weeks.
- Exact per-(visitor, subject) fact table so window-UV queries cost
  O(subject-rows): the durable end-state, but it redesigns the write path and
  its backfill; deferred until the rollup cache shows real pain.
- Dropping the 90/365-day windows: unnecessary; the stale fallback degrades
  them gracefully as retention grows.

## Consequences

- Dashboard and API consumers read aggregates up to 30 minutes stale (the
  badge already made this trade); the /data pager's first click on an
  arbitrary offset may wait ~34s once per TTL window.
- 90/365-day windows grow with 400-day retention; when their single-statement
  scans eventually exceed D1 limits, those windows freeze at their last
  successful rollup instead of erroring. The next structural step is the
  per-subject fact table.
- Between the migration and the worker deploy, a minutes-wide window of
  visitors was absent from `telemetry_visitors`; a one-time re-run of the
  backfill INSERT closed it, and any residue self-heals within a day through
  the per-heartbeat upsert.
