# Agent Note: Anonymous install telemetry via the market edge API

Status: implemented

## Problem

The family had no measure of real usage. npm download counts are inflated by the aggregate package pulling every subpackage, registry mirrors double-counting, and CI caches, so they cannot answer how many distinct DSH instances actually run these plugins. Any fix needs a unique-instance signal, but the GUI runs inside users' local browsers where telemetry must not leak conversation content or identity.

## Decision

dsh-web counts usage through two anonymous event kinds stored in the existing dsh-market.com worker's D1 database:

- Site pageviews from dsh-market.com pages (`market/src/app.js`).
- Daily plugin heartbeats from the browser half of wired packages through `shared/client/telemetry.ts` (sync-shared copy), wired into all fifteen family client plugins: Skin Center, the Workshop store, Pet, and twelve more.

Each browser generates a random UUID in localStorage once; payloads carry only that id, the UTC day, and package names or site paths. The worker hashes the id with a deployment salt before insert, never stores IPs, dedupes events per day by deterministic row id, prunes events older than 400 days, and serves aggregates only at `GET /api/telemetry/summary`. Sends are fire-and-forget and mark the local day flag only after an accepted response so offline browsers retry.

The mechanism contract lives in `docs/telemetry.md`; package README pairs link to it.

## Alternatives considered

- npm download counts: rejected, structurally inflated and unfixable.
- Third-party analytics (Umami, Plausible, Cloudflare Web Analytics): fine for the website face, but the plugin heartbeat protocol would still be custom, splitting data across backends; Cloudflare Web Analytics exposes no raw events for per-package breakdowns.
- Opt-in telemetry: rejected by product decision; default-on with full anonymity and public disclosure was chosen instead, accepting a small community-trust risk documented in every wired README.

## Consequences

- Install counts cover browsers that load a wired package; npm-only installs of unwired packages stay invisible until more packages adopt the two-step wiring.
- The write endpoint accepts anonymous traffic, so counts can be polluted by forged heartbeats; accepted as noise for trend reading rather than gating writes behind Turnstile.
- Adding a package costs one sync-shared manifest line plus one `reportDailyHeartbeat` call and keeps one shared implementation.
