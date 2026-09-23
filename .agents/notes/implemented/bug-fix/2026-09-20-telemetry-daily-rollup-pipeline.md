# Agent Note: Per-day telemetry rollups keep the dashboard windows computable

Status: implemented

## Problem

tv.dsh-market.com served a frozen series again on 2026-09-20: the 7-day view stopped at 2026-09-13 and the 30-day view at 2026-09-16, although `telemetry_events` held every day (2026-09-13: 123,160 heartbeat rows / 21,609 visitors; 2026-09-20, partial: 96,026 / 16,938). The payload the 7-day view rendered was computed 2026-09-13T06:07Z, six hours into that UTC day, which is why its last bucket showed 7,186 instances against the 21,609 the day actually reached.

The cause is the shape the [2026-09-16 note](2026-09-16-telemetry-aux-degradation-and-rollup-freshness.md) already recorded as terminal: every dashboard window ran `COUNT(DISTINCT visitor)` over the event table, which had reached 4,958,102 rows / 2.9 GB. The cron log at 2026-09-20 21:30 CST shows the 30-day pre-warm dying with `D1_ERROR: out of memory: SQLITE_NOMEM`, the channel breakdown skipped as `D1 DB is overloaded`, and the 365-day slot killed the same way; the 30-day and 365-day per-item scans fail outright at the D1 API level (`internal error 7500`), and the 7-day slot produced one successful write in four days. Degrading the auxiliary scans could not rescue the core scans the dashboard's own series needs.

## Decision

Every heartbeat and pageview window aggregate now reads per-UTC-day rollup tables that the market worker's cron trigger maintains; the heartbeat read path never touches `telemetry_events`.

- `market/worker/migrations/0008_telemetry_daily_rollup.sql` adds `telemetry_rollup_days` (the completion cursor), `telemetry_rollup_daily` (events and distinct visitors per day and kind), `telemetry_rollup_items` (per day, kind, subject) and `telemetry_rollup_dims` (per day, kind, subject, dimension value).
- `rollupDayStatements(day)` is the one definition of a day's rebuild — three deletes, five `INSERT OR REPLACE ... SELECT` aggregates, then the completion marker — validated as a UTC day bucket and executed as a single D1 batch, so a day is either fully rolled up or retried; a partial day is never marked complete.
- `refreshDailyRollups` runs before the summary pre-warm on every cron tick: today and yesterday are always rewritten (yesterday still takes events up to midnight, and a rebuild is idempotent), then the newest days the cursor still owes are backfilled inside a 60 s budget, newest first, so the short dashboard windows recover first and a killed tick resumes from the cursor.
- `assertRollupCoverage` refuses to aggregate a window whose days are not all rolled up, so `handleTelemetrySummary` keeps serving its previous complete cache row instead of publishing a short series: a one-day series reads exactly like lost data.
- The daily series, per-day active counts and item totals stay exact per day. Interval item activity, channel shares and version shares are the sum of the per-day distinct counts (按日去重求和); a window-wide `COUNT(DISTINCT visitor)` is what needs every day's visitor set in memory at once, so it does not come back. The dashboard column reads 期间活跃 and the panel note states the sum.

Aggregation cost is days × catalog (a few thousand rows for the dashboard windows, ~80k at the retention edge) instead of days × events.

## Testing

- `scripts/market-worker.test.mjs` drives the rollup path through the fake D1: the cron test pins the walk order (today, yesterday, then the newest owed day), the marker as the batch's last statement, the `idx_telemetry_kind_day` hint, both pre-warm windows and the batched rollup prune; a failing day is reported instead of aborting the tick; the incompleteness gate is pinned twice — the previous cache row is served, and 503 when none exists — each asserting no aggregate ran.
- The rollup SQL was executed against a real SQLite engine (`node:sqlite`) on a two-day fixture: the per-day series, item rows, channel/version rows, window sums, item totals and today query match the direct aggregates, an identical rebuild leaves every row unchanged, and the fixture reproduces the documented semantic delta (an instance active on both days counts twice in the interval column).

## Alternatives considered

- Adding a covering index on (kind, subject, visitor, day) and rewriting the item scan as an index-ordered `GROUP BY subject, visitor`: keeps window-wide DISTINCT semantics but stays O(window rows), the growth that broke the 30-day window on 2026-09-14 and the core scans on 2026-09-20. Relief, not repair.
- Pre-aggregating (day, kind, subject, visitor) at write time: measured on the live table, `COUNT(DISTINCT subject || '|' || visitor)` for one day is 102,748 against 102,759 rows, because the event id already dedups by visitor + item + version + channel. A fact table at that grain is the same 4.9M rows.
- Recording true daily activity (day inside the event id, one row per active instance per day) would make every window bounded, but the repeats were never stored: history cannot be rebuilt and the daily series would jump from ~20k to the real daily active count with no bridge. A metric change does not belong inside a freeze repair.
- Extending the cache TTL or pre-warming more often: the aggregation itself fails, so a longer TTL only lengthens the freeze. Leaving the daily series on the event table while rolling up only the item table keeps the dashboard's headline chart on the failing path.
- A separate offline backfill tool instead of the cron walk: the cursor table makes the scheduled walk restartable and self-healing, with no second copy of the SQL to drift.

## Consequences

- Recovery is progressive: today and the owed days roll up 30 minutes at a time, so the 7-day and 30-day windows return within the first ticks while the 90/365-day windows wait for the backfill to reach them (~5 s per day measured, so a 400-day backfill is roughly 20 hours of ticks). Until a window's days are complete, its previous cache row keeps serving rather than a short series.
- Interval item activity is now a sum: an instance active on every day of a 7-day window counts seven times where the old window-wide DISTINCT counted it once. Measured on live data, the site-level 7-day figure goes 138,489 → 165,481 (+19.5%) and the 30-day figure 500,716 → 691,196 (+38%). The per-day series, today's active counts and the item totals are unchanged.
- `telemetry_rollup_items` gains ~200 rows/day and `telemetry_rollup_dims` ~750; all four rollup tables are pruned on the same 400-day cutoff as the events and must move with it.
- A lagging backfill surfaces as a stale-but-complete dashboard: the freshness banner already reports the rollup age, and no window can silently publish a short series.
