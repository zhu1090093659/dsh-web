# Agent Note: Stable-Hostname Relay So the Paired Phone Needs Zero Setup

Status: implemented

## Problem

The named-tunnel mode (2026-09-02-named-tunnel-mode.md) fixed the restart churn but pushed every user through the Cloudflare dashboard — account, tunnel, hostname mapping, token — which violates the product requirement: **zero user configuration**. The goal is pair once, and the phone's bookmark plus pairing cookie survive every `dsh web` restart. The quick tunnel's ephemeral hostname (minted fresh per start) made the phone's origin — and therefore its cookie and sessionStorage context — die with each restart; the reopen service worker then served a cached shell with no live server behind it, which reads as a blank page.

## Decision

- **The dsh-market worker gains a relay registry**: `PUT /api/relay/register` maps a per-install id to the instance's current quick-tunnel URL; `POST /api/relay/unregister` removes it; wildcard subdomains `<id>.dsh-market.com` reverse-proxy to the registered target (HTTP + WebSocket pass-through; an explicit bilingual offline page for unknown or stale ids). Tables `relay_registrations` + `relay_rate_limit` (migration 0007); cron GC prunes stale rows and old windows.
- **The plugin registers automatically** while the auto tunnel runs (relay default on): it mints an id + 256-bit secret once per profile (`$DSH_HOME/remote-web-ui-registry/<profile>.json`, 0600) and re-announces the current tunnel URL on every tunnel start through the existing phase listener — capped backoff on failure, and an `invalid-params` failure re-claims the id once (registry row lost). The QR/public base prefers the stable origin; while registration fails it falls back to the raw quick URL. Toggle-off disposes the registrar and unregisters the row; teardown and mode changes keep both.
- **Config and UI**: `relay` (default true) surfaces as 固定域名中继 in the settings card; the pairing snapshot gains a `relay` status frame the panel renders as registering/failed notes. Named-tunnel mode is untouched (the own-domain alternative).
- **Abuse surface**: the secret is stored hashed (SHA-256), targets are restricted to `*.trycloudflare.com`, registrations are rate-limited per IP and per id, rows GC after 90 idle days, and every relay response is `noindex`.
- The structural fact that makes a byte-forwarding proxy enough: the phone never faces harness browser-auth — `/pair-app` is a plugin exact route and all phone traffic rides the gated `/remote` channel re-issued to loopback with the process's inner credential — so the relay only needs to move bytes; cookies and sessionStorage are origin-scoped and that origin never changes.

## Testing

- `scripts/market-relay.test.mjs`: id extraction, mint/refresh secret-hash auth, bad target/secret rejection, Host rewrite on proxy, offline page, unregister, per-id rate limit, and non-relay dispatch isolation (8 node tests).
- `packages/dsh-remote-web-ui/tests/relay-registry.spec.ts`: identity file build/mint/persist/isolation, stable-base shape, registrar announce/refresh/backoff/re-claim/dispose/unregister (12 vitest cases).
- Full plugin suite 333 green; `i18n:check`, `docs:check`, and package typecheck pass. Live verification (wrangler dev register → proxy → pair round trip; then a real restart with the phone) is the delivery gate.

## Alternatives considered

- **Named tunnel as the default** (2026-09-02-named-tunnel-mode.md): rejected as the default because the dashboard setup violates zero-config; kept as the own-domain alternative, cross-linked.
- **A 302 redirect instead of proxying**: cookies stay scoped to the changing hostname, so re-pairing persists; the stable origin must proxy.
- **A two-level relay hostname** (`*.t.dsh-market.com`): deployed first, then abandoned — Universal SSL covers exactly one subdomain level, so second-level relay hosts got no certificate and failed the TLS handshake at the edge; single-label `<id>.dsh-market.com` is covered by the existing certificate.
- **A path-prefix origin** (`dsh-market.com/r/<id>/`): the official shell references absolute paths that escape the prefix; subdomains keep root-path semantics.
- **A self-hosted non-CF relay** (frp/rathole on a VPS): real infrastructure and TLS operations for no user-visible gain; rejected while the market already lives on Cloudflare.
- **A plugin-native outbound WebSocket tunnel** (Durable Objects relay): drops the trycloudflare dependency entirely but owns a tunnel protocol (auth, reconnect, framing, backpressure); deferred until the quick-tunnel terms-of-service posture changes.

## Consequences

- Phone restarts are invisible by default; the price is one extra edge hop operated by the package author (disclosed in the README security model — the same edge that terminates the quick tunnel's TLS).
- Deployment needs the worker route plus a wildcard DNS record `*.dsh-market.com` before the relay works; until then the plugin degrades to today's raw quick URL behavior.
- Multiple profiles on one host each get their own identity and subdomain; rate limits and the TTL bound abuse; one D1 read per request is the proxy's only storage cost.
