-- dsh-market: remote relay registry.
--
-- The remote-web-ui plugin registers each dsh web instance (per profile) so
-- its ephemeral quick-tunnel URL is reachable through a stable subdomain
-- (<id>.t.dsh-market.com). The plugin mints id + secret on first run, then
-- re-registers the current tunnel URL on every tunnel start; the phone keeps
-- one origin, so its bookmark and pairing cookie survive restarts.
CREATE TABLE IF NOT EXISTS relay_registrations (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  target TEXT NOT NULL,
  registered_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

-- Fixed-window rate limiting for the registration endpoint (one row per
-- window per identity bucket), pruned by the cron trigger. Reads and writes
-- ride one D1 batch with the registration mutation.
CREATE TABLE IF NOT EXISTS relay_rate_limit (
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (bucket, window_start)
);