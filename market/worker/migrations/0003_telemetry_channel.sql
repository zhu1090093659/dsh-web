-- dsh-market: per-item install channel for telemetry heartbeats
-- (market = Workshop install, npm = registry install, unknown/'' = not determinable).
ALTER TABLE telemetry_events ADD COLUMN channel TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_telemetry_channel ON telemetry_events(kind, subject, channel);
