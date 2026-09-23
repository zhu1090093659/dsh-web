# Agent Note: remote-web-ui dynamic trusted hosts stay bounded

Status: implemented

## Problem

The docker/reverse-proxy pairing work ([docker pairing adaptation](2026-09-04-remote-web-ui-docker-pairing-adaptation.md)) introduced `dynamicTrustedHosts` in `makeRoutes` as a process-lifetime `Set<string>` with three insertion sites and no eviction or cap. The table is fed by caller-controlled `Host` headers: any request that satisfies `isPrivateOrLocalHostname` (every RFC 1918 IPv4 literal, IPv6 ULA/link-local prefixes, `*.local`/`*.lan`/`*.internal`/`*.home.arpa` names) plus a live device credential (`isPairedDeviceRequest`/`hasDevice`, or a one-time token on the accept paths) permanently adds that authority. A caller holding any live device id can therefore send a stream of requests with distinct private Host headers and grow the set without bound.

Two costs follow. Memory: an unbounded structure in a long-lived daemon. CPU on the phone-facing hot path: every `lanFence` call spreads the whole set into a fresh array and the host check inside `isTrustedApiRequest`/`isTrustedHost` runs one `new URL()` parse per entry per request, so each extra entry taxes every subsequent gated request.

## Decision

`dynamicTrustedHosts` is now bounded through the exported pure helper `addBounded(set, value, max)` with `MAX_DYNAMIC_TRUSTED_HOSTS = 64`: a repeat insert is a no-op, and past the cap the oldest entry (Set insertion order) is evicted before the new one is added. All three former `.add()` sites in `makeRoutes` (the `lanFence` cookie path, the POST accept path, the `/pair-accept` page path) go through the helper.

Behavior is preserved for legitimate flows. A capped-out table only drops stale authorities; a cookie-carrying device whose host was evicted re-adds it on its next gated request through the same `lanFence` fallback that created the entry, and the cookieless flow re-pairs through `/pair-accept`, which has its own private-LAN fallback. The trust semantics per request are unchanged — the cap only bounds the memo table, never grants or removes trust by itself.

## Testing

- `tests/routes.spec.ts` gains a unit test for `addBounded`: insertion order, idempotent re-add, oldest-first eviction at the cap, and a flood of `4 x MAX_DYNAMIC_TRUSTED_HOSTS` distinct hosts leaving exactly `MAX_DYNAMIC_TRUSTED_HOSTS` entries with the first host evicted and the last present.
- The existing route families (`routes.spec.ts`, `docker-pairing.spec.ts`, `remote-api.spec.ts`, `remote-upgrade.spec.ts`) cover the wiring at the three call sites and pass unchanged in behavior.

## Alternatives considered

- Expiring entries by time (mirroring the `acceptAttempts` window prune): rejected — a time-based table needs a sweep and a tuning knob for a cache whose entries are self-healing; FIFO at a cap achieves the bound with no timer and no policy to get wrong.
- Dropping the dynamic table and re-deriving trust per request from the cookie alone: rejected — the cookieless mobile flow (the one-time `?grant=` landing on `/pair-app`, `?device=` when this note was written — see [the one-time landing grant](../../architecture/2026-09-21-remote-one-time-landing-grant.md)) and reverse-proxy topologies rely on the remembered authority to pass `lanFence` after `/pair-accept`; removing the table would break the flow the [docker pairing adaptation](2026-09-04-remote-web-ui-docker-pairing-adaptation.md) shipped.
- Validating dynamic entries against configured `trustedHosts` only: rejected — the table exists precisely for authorities no configuration knows about (container bridge IPs, rotating proxy hosts).

## Consequences

The plugin's phone-facing fence no longer grows an attacker-influenceable table: worst case is a fixed 64 entries and 64 URL parses per gated request. A hostile paired device can evict legitimate authorities by flooding, but the effect is a one-request self-heal for cookie-carrying devices and a re-pair for cookieless ones — no access escalation either way, and flooding already requires a live device credential.
