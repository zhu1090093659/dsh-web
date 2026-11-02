-- dsh-market: the lease row's own answer for the claim fast path.
--
-- A claim used to converge the account on every attempt: four Cloudflare calls
-- (find the tunnel, write its ingress, find the CNAME, read the connector
-- token) whether or not anything had moved. Under a claim storm that is what
-- spent the account's 1200/300s request budget, and a spent budget fails the
-- claims that caused it, which makes the clients retry -- the loop that kept
-- the budget at zero for six days.
--
-- These three columns let a row that already describes the account answer the
-- next claim with no account call at all (LEASE_CONVERGED_TTL_MS):
--
--   converged_at  when the tunnel, its ingress and the CNAME were last written
--                 (NULL for a bridged lease, which owns no account object)
--   token_cache   the connector token read at that convergence, so the token
--                 endpoint is not read on every claim
--   token_at      when that token was read, on its own longer clock
--                 (LEASE_TOKEN_TTL_MS), so a rotated token is refreshed
--
-- A NULL in converged_at or token_at is read as "never converged" and simply
-- re-converges, so rows written before this migration keep working.
ALTER TABLE relay_leases ADD COLUMN converged_at INTEGER;
ALTER TABLE relay_leases ADD COLUMN token_cache TEXT;
ALTER TABLE relay_leases ADD COLUMN token_at INTEGER;

-- The deployment default also flips from the quick tunnel to the bridge (see
-- relayModeOf in src/relay-control.js). The mode column's own default stays
-- 'quick' (migration 0010 -- SQLite has no ALTER COLUMN) and it no longer
-- matters, because the claim names the column in its INSERT and writes the
-- mode it resolved rather than leaning on a schema default. That INSERT is the
-- only place the claim writes mode: the upsert's DO UPDATE half omits it on
-- purpose, so an existing row keeps the mode it recorded. The new default
-- therefore reaches the leases first claimed after the flip, not the rows
-- already on the fleet, and a claim can neither apply an operator's per-row
-- flip nor undo one -- that stays a single UPDATE.