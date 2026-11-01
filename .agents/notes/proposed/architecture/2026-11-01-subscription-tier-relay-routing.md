# Agent Note: Subscription-Tier-Based Relay Routing

English | [中文](2026-11-01-subscription-tier-relay-routing.zh.md)

Status: proposed

This note succeeds the un-gated transport assumption in [self-hosted relay meeting point](2026-11-01-selfhosted-relay-meeting-point.md) and earlier routing contracts. It establishes the control-plane and data-plane rules for gating remote rendezvous paths by account subscription tier: routing free-tier instances to the Cloudflare Worker relay on `dsh-market.com` while directing Plus and Pro subscribers to the dedicated Go meeting point on `relay.chatwithai.icu`.

## Problem

Two rendezvous systems operate concurrently in production: the Cloudflare Worker relay (`<id>.dsh-market.com`) and the self-hosted Go meeting point (`<id>.relay.chatwithai.icu`, described in [self-hosted relay meeting point](2026-11-01-selfhosted-relay-meeting-point.md)). However, no mechanism routes client and host traffic according to user subscription tiers.

The desktop host relay identity is an anonymous ID and secret minted locally on disk (`packages/dsh-remote-bridge/src/host/relay-registry.ts:71-103`), with base suffix default `RELAY_BASE_SUFFIX` (`packages/dsh-remote-bridge/src/host/relay-registry.ts:37`), maintaining zero association with account credentials or subscription tiers.

The mobile client (`iphone_remote_use_dsh` repository's `Remote/App/AppModel.swift:23,305`) persists only a single connection origin.

By default, all desktop hosts dial the Cloudflare relay (`packages/dsh-remote-bridge/src/index.ts:533-534`). If a host switches its configured rendezvous URL, free and paid instances flood the self-hosted VPS indiscriminately without admission control, quota partitioning, or account-aware routing.

## Proposal

Introduce subscription-tier-based relay routing without compromising host-side anonymity or trusting client-asserted claims. Mobile clients exchange a scoped relay authorization credential (`grant`) upon account login and transfer it to paired desktop hosts over an encrypted protocol frame. The host uses this grant to claim a lease on the self-hosted relay. The self-hosted relay executes an internal loopback request against the account service to determine instantaneous tier entitlement and write quota limits into the lease, without recording user identity. Desktop hosts advertise preferred meeting points via `hello` responses, enabling mobile clients to maintain primary and secondary candidate origins with automatic downgrade fallback to the Cloudflare relay.

## Context & Efficiency Impact

- **Zero LLM token footprint:** Relay routing, lease negotiation, and origin selection operate strictly at the transport and connection layer via lightweight JSON and binary control frames, consuming zero LLM context tokens.
- **Minimal schema overhead:** The desktop host device roster increments schema version from 3 to 4 (`packages/dsh-remote-bridge/src/core/devices.ts:27,81`), purely appending an optional `relay` metadata block. Mobile origin failover stores at most two rendezvous candidates for the same host ID, beside the existing LAN fast path (`Remote/Sources/RemoteKit/OriginFailover.swift:30-72,104-118`).
- **Bounded context and network budget:** Grants carry a 30-day TTL, claims refresh on a 6-hour interval, and tier entitlements are evaluated instantaneously at claim time. Egress bandwidth counters reside in relay memory and reset at UTC 00:00, avoiding continuous database write overhead or intrusive traffic shaping.

## Architecture and Trust Boundaries

### Grant Issuance and Host Roster Handoff

Following user login, the mobile client requests a relay authorization credential (`grant`, TTL 30 days) from the account service (`POST /v1/relay/grant`). This grant is used solely for relay admission: it contains no device fingerprints, device tokens, or instance hardware identifiers.

Over an authenticated, paired connection, the mobile client delivers the grant to the desktop host using the new `relay.grant` protocol frame. The host commits the grant into its local persistent device roster (`packages/dsh-remote-bridge/src/core/devices.ts:27,81`).

### Loopback Verification and Anonymity Preservation

The desktop host presents the grant in its lease claim payload (`POST /v1/relay/claim`, `packages/dsh-remote-bridge/src/host/relay-control.ts:24,38-40,100-108`) to the self-hosted relay. The self-hosted Go relay does not parse subscription tiers directly. Instead, it queries the account service over an internal loopback endpoint (`POST /internal/relay/grant`, `Server/go/internal/api/server.go:334-345`, `Server/go/internal/api/relaytoken.go`), authenticated by a pre-shared secret. The Nginx reverse proxy strictly blocks external access to the `/internal/` path prefix.

The account service returns the instantaneous subscription tier (free, plus, or pro). The relay decides admission and assigns stream and bandwidth quotas, persisting only resource limits in `relay_leases`. Crucially, the relay **never writes `userId` into the lease table**.

Subscription tiers never enter host business logic: the desktop host remains unaware of account identities, operating solely on the binary state of whether it holds an active lease or not.

## Dual-Origin Candidate Routing

### Origin Preference and Announcement

The desktop host determines its preferred meeting point based on the lease it currently holds. If it holds an active self-hosted lease, its primary meeting point is `<id>.relay.chatwithai.icu`; otherwise, it remains `<id>.dsh-market.com` (`packages/dsh-remote-bridge/src/host/relay-registry.ts:37`).

In the protocol v1 handshake, the host's `hello` response optionally appends `relay: {origin: string}` (`packages/dsh-remote-bridge/src/core/connection.ts:1135-1156`). The mobile client accepts and acts on this announcement **strictly on an already-paired connection**.

### Client Candidate Ledger and Failover Order

At application launch, because the user's subscription tier is initially unknown, the client's initial dial always routes through `WhaleOrigin` / the deployment default (`dsh-market.com`), rather than immediately dialing the self-hosted address. The announced meeting point is committed to the origin ledger (`Remote/Sources/RemoteKit/OriginFailover.swift:30-72,104-118`) only after `GET /v1/me` confirms a Plus or Pro subscription tier. This routing update takes effect in the **subsequent connection epoch** (tapping Reconnect in settings applies it immediately); in that subsequent epoch, the client dials the announced self-hosted origin as its primary relay candidate and retains the same host ID on the Cloudflare domain as its secondary candidate.

The secondary candidate exists only after an explicit announcement has been received and tier entitlement is confirmed. The local area network (LAN) direct connection path retains its existing location and priority, evaluated after both rendezvous meeting point candidates.

### Uninterrupted Sessions and Zero Re-Pairing

No re-pairing is required when switching meeting points: the host ID (`<id>`) and `deviceToken` remain identical across both endpoints, changing only the hostname suffix. The pairing QR code continues to serve exclusively the `dsh-market.com` address, guaranteeing that initial 30-second bootstrap pairings always use the universally reachable Cloudflare path.

Active connections are not torn down to force an address migration: origin announcements govern only the subsequent connection epoch. Tapping Reconnect in the mobile application settings applies the change immediately.

## Downgrade Grace and Deterministic Fallback

### Lease Expiration and Host Retry Semantics

Lease TTL is 24 hours. The desktop host refreshes its claim every 6 hours, prompting the self-hosted relay to re-verify the grant against the account service in real time. Following a subscription downgrade (e.g. Plus or Pro expiration), the host loses its self-hosted lease within 6 hours at most (or upon its next process startup if offline).

Host-side error handling in `relayClaimRetryOf` (`packages/dsh-remote-bridge/src/host/relay-control.ts:250`) currently treats all HTTP 403 responses as terminal failures. Under this design, a new branch handles `403 tier-required`: it releases the self-hosted lease, ceases announcing the self-hosted origin in `hello`, and retries with a long 6-hour cooldown (`retry: true, refreshIdentity: false`). The host's parallel `dsh-market.com` lease and connector socket remain completely untouched.

### Client Fallback and Memory Invalidation

When a mobile client still holds the self-hosted address but cannot connect due to an address-class failure (HTTP 502 connector-offline from `Server/go/internal/relay/server.go:177`, HTTP 404, TLS negotiation failure, or TCP connection timeout per `Remote/Sources/RemoteKit/LinkFailure.swift:43-46`), it immediately falls back to the same host ID on `dsh-market.com`.

Upon successfully connecting via Cloudflare, if the host's `hello` response omits the `relay` announcement, the mobile client invalidates its cached self-hosted candidate. This fallback requires no server push notification and zero manual configuration changes by the user.

The operational cost of a downgrade is bounded: the client's first reconnection after downgrade incurs exactly one failed dial attempt before falling back, adding approximately one connection timeout duration.

## Authentication and Quota Allocation

Capacity limits, rate limits, and admission policies are partitioned strictly by subscription tier:

| Tier | Self-Hosted Admission | Concurrent Streams | Attach Rate Limit | Daily Egress Quota |
| --- | --- | --- | --- | --- |
| free | Refused `tier-required` | – | – | – |
| plus | Admitted | 64 | 6/60s/id, 30/60s/IP | 2 GB per lease |
| pro | Admitted | 128 | 6/60s/id, 30/60s/IP | 8 GB per lease |

- **Over-quota enforcement:** Exceeding stream or bandwidth quotas rejects new streams with HTTP `429 quota-exceeded` (`req` or `ws-open` control frames; the concurrent-stream ceiling is `Server/go/internal/relay/bridge.go:152`, and the attach rate-window constants are `Server/go/internal/relay/server.go:273-276`), without terminating already established active streams.
- **Daily bandwidth accounting:** Egress bandwidth is tracked per lease ID in memory, resetting automatically at UTC 00:00 without active packet throttling or fine-grained traffic shaping.
- **Free tier allocation:** The free tier receives zero bytes of self-hosted quota; its remote control capabilities remain entirely hosted on the Cloudflare Worker relay.

## Protocol Increments

All protocol enhancements remain on major version 1, minor version 21 without incrementing version numbers:

1. The `hello` response appends an optional key `relay?: {origin: string}` (`packages/dsh-remote-bridge/src/core/connection.ts:1135-1156`), indicating the host's preferred rendezvous endpoint for subsequent connections.
2. A new capability identifier `relay.tier.v1` is conditionally advertised in `hello.r.capabilities` only when a second meeting point is configured, and does not enter `SERVED_CAPABILITIES`; the protocol remains at `proto: 1`, `minor: 21`. Rationale is documented faithfully as an explicit tradeoff: this card's hard boundary requires that an unconfigured host produces a byte-for-byte identical handshake, whereas `core/protocol.ts` defines entering `SERVED_CAPABILITIES` as a minor version increment—the two are mutually exclusive, so we choose the former and state this deviation explicitly. The client sends the `relay.grant` frame only upon seeing this advertisement; on an unconfigured host, `relay.grant` returns `unknown-method` (or `unpaired` on an unpaired connection).
3. A new request `relay.grant` accepts `{grant: string}` and responds with `{ok: true}`; requests on unconfigured hosts return error `unknown-method`, and requests on unpaired connections return error `unpaired`.
4. The host lease claim payload appends an optional `grant` string (`packages/dsh-remote-bridge/src/host/relay-control.ts:100-108`); the relay control plane introduces error codes `tier-required`, `grant-invalid`, and `lease-stale`. The self-hosted relay requires the lease `claimed_at` timestamp to be within 24 hours upon connector attach; an expired lease returns `403 {"error":"lease-stale"}`. The host immediately triggers a re-claim upon this refusal (restoring the connection if accepted, or entering the 6-hour cooldown if refused).
5. The desktop host device roster schema increments from version 3 to 4 (`packages/dsh-remote-bridge/src/core/devices.ts:27,81`), adding a purely additive `relay` block.
6. The account service introduces two REST endpoints: `POST /v1/relay/grant` (session-authenticated grant issuance) and `POST /internal/relay/grant` (loopback grant evaluation via internal shared secret, `Server/go/internal/api/server.go:334-345`, `Server/go/internal/api/relaytoken.go`).
7. The host retry decision function `relayClaimRetryOf` (`packages/dsh-remote-bridge/src/host/relay-control.ts:250`) adds a dedicated branch for `403 tier-required` returning `{ retry: true, delayMs: 21_600_000, refreshIdentity: false }`. This branch is deliberately not clamped by `CLAIM_RETRY_MAX_MS` (300 s, `relay-control.ts:96-97,248-252`), which keeps bounding only the rate-limit path.

## Default Behavior and Grey Release Boundary

- **Zero-configuration compatibility:** Without explicit configuration, the desktop host acquires only the Cloudflare lease (`dsh-market.com`), pairing QR codes output only the dsh-market domain, `hello` omits `relay`, and client behavior remains unmodified.
- **Configuration options:** Secondary relay endpoints are governed by `relaySecondaryControlUrl` and `relaySecondaryPublicSuffix` (`packages/dsh-remote-bridge/src/index.ts:533-534`), defaulting to `undefined` (disabled).
- **Phased rollout boundary:** This specification authorizes activating the secondary relay exclusively on local developer profiles. Flipping defaults globally to enable the self-hosted relay across all hosts is deferred to a subsequent milestone card.

## Alternatives considered

- **Long-term binding of relay leases to user accounts.** Rejected. Persisting `userId` inside `relay_leases` creates an unnecessary, linkable record mapping user identities to physical desktop machines. Because admission requires only an instantaneous entitlement check at claim time, storing user IDs in the relay database violates data minimization principles.
- **Client-self-asserted subscription tiers.** Rejected. Client-asserted headers or parameters are not a security trust boundary; any modified client could forge tier claims to bypass quotas. Entitlement verification must be cryptographically signed by the account service and validated out-of-band by the relay server.
- **Distinct entry points per tier requiring re-pairing.** Rejected. Forcing users to re-scan pairing QR codes and re-bootstrap `deviceToken` upon upgrading or downgrading introduces severe user friction. Employing the same host ID across distinct domain suffixes decouples rendezvous routing from device authentication.
- **Single ingress with server-side proxying to upstream tiers.** Rejected. Routing all traffic through a single Cloudflare apex and forwarding paid sessions to the self-hosted VPS would still force 100% of data plane bytes through Cloudflare Workers, defeating the primary objectives of vendor independence and edge API rate-limit avoidance.

## Acceptance criteria

- **Probe instance verification:** An isolated DSH test instance (`DSH_HOME=/tmp/dsh-verify-relay-tier`) validates that an unauthenticated host claim receives `403 tier-required` and enters a 6-hour backoff without terminating; a host with a Plus grant successfully acquires a lease and opens connector WebSocket; a downgraded grant causes the lease to be revoked at the next 6-hour refresh.
- **Physical device validation:** Upgrade and downgrade transitions are executed on a physical iOS device, recording origin transition time on upgrade and failover duration on downgrade.
- **Cross-repository documentation parity:** Documentation in the `iphone_remote_use_dsh` repository (`docs/account-and-subscription.md:24,226-238` and `docs/protocol-v1.md`) is updated to match this specification in the same change set.
- **Mechanical documentation gates:** `pnpm docs:check` and `pnpm i18n:check` pass without errors or warnings.

## Risks

- **VPS single point of failure for paid tiers:** While free-tier traffic remains on Cloudflare, Plus and Pro subscribers route through the dedicated VPS (`relay.chatwithai.icu`). If the VPS experiences hardware failure or network downtime, paid instances temporarily lose self-hosted performance benefits until automatic fallback to `dsh-market.com` completes.
- **Wildcard TLS certificate maintenance:** The `*.relay.chatwithai.icu` domain requires continuous Let's Encrypt DNS-01 certificate renewals. Automated renewal scripts and alert monitoring are required to prevent certificate expiration.
- **Mixed-tier multi-device pairing asymmetry:** When multiple mobile devices with different subscription tiers pair with the same desktop host, the host acquires a self-hosted lease if at least one paired device provides a valid Plus or Pro grant. Free-tier devices paired with that same host do not possess the grant and continue routing over `dsh-market.com`. This asymmetric dual-origin routing is an accepted operational boundary.
