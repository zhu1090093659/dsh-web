-- dsh-market: telemetry read-path scaling.
--
-- telemetry_events grows ~150-290k rows/day (every active browser sends one
-- pre-deduped heartbeat row per item per UTC day), and every summary
-- aggregate filters on kind + day before grouping. Without an index each of
-- the nine summary statements full-scans the wide table (2M+ rows, ~18-25s
-- each), so the whole summary batch now exceeds D1's limits and the
-- dashboard at tv.dsh-market.com answers 503. The covering index turns every
-- aggregate into an index-only scan; the standalone day index lets the
-- 30-minute retention DELETE probe a range instead of scanning the table.
CREATE INDEX IF NOT EXISTS idx_telemetry_kind_day
  ON telemetry_events (kind, day, visitor, subject, version, channel);
CREATE INDEX IF NOT EXISTS idx_telemetry_day
  ON telemetry_events (day);

-- All-time distinct heartbeat visitors (the public users badge) can no
-- longer be COUNT(DISTINCT) over the ever-growing event table either; the
-- write path now upserts one pre-deduped row per visitor here and the cron
-- counts this small table instead. Backfill keeps the badge continuous.
CREATE TABLE IF NOT EXISTS telemetry_visitors (
  kind TEXT NOT NULL,
  visitor TEXT NOT NULL,
  PRIMARY KEY (kind, visitor)
);
INSERT OR IGNORE INTO telemetry_visitors (kind, visitor)
  SELECT 'hb', visitor FROM telemetry_events WHERE kind = 'hb';

-- Rollup cache for GET /api/telemetry/summary, keyed by the exact query
-- window (days + both pagination windows). The handler serves a fresh row
-- directly, recomputes live after the TTL, and falls back to a stale row
-- when D1 cannot serve the live aggregation; the cron trigger pre-warms the
-- windows the dashboard actually requests. Mirrors the badge_cache pattern.
CREATE TABLE IF NOT EXISTS telemetry_summary_cache (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  computed_at INTEGER NOT NULL
);
