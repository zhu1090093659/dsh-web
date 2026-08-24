-- dsh-market: anonymous usage telemetry (site pageviews + plugin heartbeats).
-- One row per (visitor hash, kind, subject, UTC day); id is derived from
-- those fields so replays collapse via INSERT OR IGNORE.
CREATE TABLE IF NOT EXISTS telemetry_events (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  visitor TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telemetry_day_kind ON telemetry_events(day, kind);
CREATE INDEX IF NOT EXISTS idx_telemetry_kind_subject ON telemetry_events(kind, subject);
