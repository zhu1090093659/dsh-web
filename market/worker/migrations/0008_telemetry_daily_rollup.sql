-- dsh-market: per-day telemetry rollups.
--
-- Window aggregates used to run COUNT(DISTINCT visitor) straight over
-- telemetry_events. That table adds ~130-230k rows/day (one row per new
-- visitor/item/version/channel combination) and reached 4.96M rows / 2.9GB by
-- 2026-09-20: the 30-day summary scans built temp B-trees larger than D1's
-- memory (SQLITE_NOMEM), the per-item window scans failed outright, and the
-- dashboard served the last successful rollup — frozen at 2026-09-13 (7-day
-- view) and 2026-09-16 (30-day view) although every raw day was intact
-- (2026-09-16 telemetry-aux-degradation-and-rollup-freshness note).
--
-- These four tables carry the per-UTC-day aggregates the dashboard reads, so
-- every window query scans days x catalog rows instead of days x events:
--   telemetry_rollup_days  — days whose rollup is complete (backfill cursor)
--   telemetry_rollup_daily — events + distinct visitors per day and kind
--   telemetry_rollup_items — events + distinct visitors per day, kind, subject
--   telemetry_rollup_dims  — distinct visitors per day, kind, subject, dimension
--
-- The cron trigger rewrites today and yesterday on every tick and backfills
-- the newest missing days with the remaining time budget, so a day is rolled
-- up once its events stop arriving and partial ticks self-heal. Interval item
-- and dimension totals are the sum of the per-day distinct counts (the
-- dashboard labels them 按日去重求和), which is what makes this layer bounded:
-- the read path never touches telemetry_events for the heartbeat series.
CREATE TABLE IF NOT EXISTS telemetry_rollup_days (
  day TEXT PRIMARY KEY,
  computed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS telemetry_rollup_daily (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  events INTEGER NOT NULL,
  uv INTEGER NOT NULL,
  PRIMARY KEY (day, kind)
);

CREATE TABLE IF NOT EXISTS telemetry_rollup_items (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  events INTEGER NOT NULL,
  uv INTEGER NOT NULL,
  PRIMARY KEY (day, kind, subject)
);

CREATE TABLE IF NOT EXISTS telemetry_rollup_dims (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  dim TEXT NOT NULL,
  value TEXT NOT NULL,
  uv INTEGER NOT NULL,
  PRIMARY KEY (day, kind, subject, dim, value)
);
