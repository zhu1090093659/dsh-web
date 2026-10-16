# Agent Note: Stable-Hostname Relay So the Paired Phone Needs Zero Setup

Status: implemented

## Problem

The named-tunnel mode (2026-09-02-named-tunnel-mode.md) fixed the restart churn but pushed every user through the Cloudflare dashboard — account, tunnel, hostname mapping, token — which violates the product requirement: **zero user configuration**. The goal is pair once, and the phone's bookmark plus pairing cookie survive every `dsh web` restart. The quick tunnel's ephemeral hostname (minted fresh per start) made the phone's origin — and therefore its cookie and sessionStorage context — die with each restart; the reopen service worker then served a cached shell with no live server behind it, which reads as a blank page.

## Decision

- **The dsh-market worker gains a relay registry**: `PUT /api/relay/register` maps a per-install id to the instance's current quick-tunnel URL; `POST /api/relay/unregister` removes it; wildcard subdomains `<id>.dsh-market.com` reverse-proxy to the registered target (HTTP + WebSocket pass-through; an explicit bilingual offline page for unknown or stale ids). Tables `relay_registrations` + `relay_rate_limit` (migration 0007); cron GC prunes stale rows and old windows.
- **The plugin registers automatically** while the auto tunnel runs (relay default on): it mints an id + 256-bit secret once per profile (`$DSH_HOME/remote-web-ui-registry/<profile>.json`, 0600) and re-announces the current tunnel URL on every tunnel start through the existing phase listener — capped backoff on failure, and an `invalid-params` failure re-claims the id once (registry row lost). The QR/public base prefers the stable origin; while registration fails it falls back to the raw quick URL. A phone on the machine's own network is then moved off that origin by the landing page, which probes the advertised LAN literals and keeps the public source when none answers ([2026-10-16-pairing-auto-lan-source.md](2026-10-16-pairing-auto-lan-source.md)). Toggle-off disposes the registrar and unregisters the row; teardown and mode changes keep both.
- **Config and UI**: `relay` (default true) surfaces as 固定域名中继 in the settings card; the pairing snapshot gains a `relay` status frame the panel renders as registering/failed notes. Named-tunnel mode is untouched (the own-domain alternative).
- **Abuse surface**: the secret is stored hashed (SHA-256), targets are restricted to `*.trycloudflare.com`, registrations are rate-limited per IP and per id, rows GC after 90 idle days, and every relay response is `noindex`.
- **Hashed build assets are cached immutably at this hop.** The tunneled instance serves `/assets/**` without any `Cache-Control`, `ETag` or `Last-Modified`, and a verbatim pass-through left the phone with nothing to cache against: it re-fetched the shell on every load — measured 237502 B per request at 1.3-2.3 s TTFB through the relay, byte-identical each time. The proxy now stamps `public, max-age=31536000, immutable` on `GET`/`HEAD` 200 responses whose path names a content-hashed build asset under `/assets/`; every other path (`/api/*`, documents, unhashed names, WebSocket upgrades, non-200) keeps the origin's own headers.
- The structural fact that makes a byte-forwarding proxy enough: the phone never faces harness browser-auth — `/pair-app` is a plugin exact route and all phone traffic rides the gated `/remote` channel re-issued to loopback with the process's inner credential — so the relay only needs to move bytes; cookies and sessionStorage are origin-scoped and that origin never changes.

## Testing

- `scripts/market-relay.test.mjs`: id extraction, mint/refresh secret-hash auth, bad target/secret rejection, Host rewrite on proxy, immutable caching of hashed assets only (nested chunk paths included, and never a non-200), offline page, unregister, per-id rate limit, and non-relay dispatch isolation (10 node tests).
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
- Deployment needs the wildcard hostname binding before the relay works: the zone route (below) plus the `*.dsh-market.com` Workers custom domain that owns the wildcard DNS record; until both exist the plugin degrades to today's raw quick URL behavior.
- Multiple profiles on one host each get their own identity and subdomain; rate limits and the TTL bound abuse; one D1 read per request is the proxy's only storage cost.
- Immutable caching is client-side only: the edge keeps answering these with `cf-cache-status: DYNAMIC`, so a device still pays the full tunnel cost on its first load and the gain starts at the second. Caching them at the edge too would need `ctx.waitUntil` plus the Cache API, deliberately not taken here.

## Production incident (2026-09-02 evening): the route pattern matched only the root path

First real-world pairing after the restart landed the phone on a Cloudflare 522. Root cause: the zone route pattern `*.dsh-market.com` had no path part, and a Workers route pattern without a path component matches **only the root path** — every non-root request on a relay host (`/pair-app`, `/api/*`, `/remote`, anything) never reached the worker and fell through to the DNS origin: the manual `*` A record pointed at 192.0.2.1 (slow 522, ~19s connect timeout), later the CF-managed custom-domain placeholder (fast 522, ~0.25s). The relay's very first phone request is a non-root path, so the feature never worked for its intended flow, while every root-path probe succeeded.

The misread lasted hours because root and non-root probes alternated: successes were all root-path, failures all non-root, which looked like minute-scale "edge flapping". Eliminated along the way: DNS (authoritative DoH), tunnel health (direct probes), worker invocation, D1 rows, response caches (fresh paths + `cache-control: no-cache`), and subrequest shape. The decisive instrument was a **rowless valid id**: the 503 offline page is a worker signature, and on non-root paths it 522'd instead — the worker was never invoked. Lesson: probe one variable at a time, and treat a worker-generated response (offline page, real auth page body) as the invocation signal rather than "any response".

Fixes shipped together:

- Route pattern corrected to `*.dsh-market.com/*` (the `/*` is mandatory for non-root paths; enforced by the config comment).
- Wildcard DNS moved from the manual `*` A record to a dashboard-created `*.dsh-market.com` Workers custom domain, so CF owns the record and no placeholder origin exists.
- `wrangler.jsonc` declares only zone routes, never `custom_domain`: wrangler (as of 4.128) rejects wildcard custom domains locally, and any deploy declaring even one `custom_domain` route PUT-replaces the worker's whole domain list (verified in wrangler source, `publishCustomDomains` → `PUT /domains/records`) — silently detaching dashboard-created domains, which actually happened once during diagnosis. Deploys print no warning for that detach; verify domain survival with a DoH lookup of a fresh subdomain after any route or domain change.

Second layer, same evening: with the route fixed, the phone's QR landing returned the plugin's plain `forbidden` (403) instead of the pairing page. Root cause: **Workers `fetch` forces the origin-side Host header to the URL authority** — the `host` header is a forbidden header stripped at Request construction, so a relay subrequest can never present the relay origin to the tunneled instance; the origin always sees the tunnel hostname. Two server-side checks are Host-bound and both failed on the tunnel hostname: the plugin's phone-facing fence trusts the configured public host (`publicBaseUrl` = the relay origin), and the harness browser-auth binds its cookie to the Host authority (the phone's cookie jar is scoped to the relay origin it navigates). The old direct-tunnel flow only worked because `publicBaseUrl` used to BE the tunnel URL. Fix: the plugin stamps the stable origin at the connector — the quick `TunnelTarget` carries `originHostHeader`, wired from the registrar's base, and the factory adds cloudflared `--http-host-header` so the local webserver sees the relay origin on every request (HTTP and WebSocket). Changing the target identity also restarts a running tunnel on a relay toggle (the manager's target idempotence). Lesson: a reverse proxy in front of Host-bound application state must guarantee the Host end-to-end; in Workers that is impossible from the proxy itself, so the connector owns it.
