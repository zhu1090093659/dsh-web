-- dsh-market: precomputed public badge counts.
-- The heartbeat distinct-visitor count scans the full telemetry_events table
-- (1M+ rows), which exceeds shields.io's ~3.5s fetch timeout, so the badge
-- handler reads this single indexed row and a cron trigger refreshes it.
CREATE TABLE IF NOT EXISTS badge_cache (
  id TEXT PRIMARY KEY,
  value INTEGER NOT NULL,
  computed_at INTEGER NOT NULL
);
