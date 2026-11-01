# Agent Note: Self-Hosted Relay Meeting Point on relay.chatwithai.icu

English | [中文](2026-11-01-selfhosted-relay-meeting-point.zh.md)

Status: proposed

This note succeeds the Cloudflare Worker rendezvous decision in [relay transport v2](2026-10-23-relay-bridge-transport.md). It carries forward the multiplexed bridge frame contract and capacity model established there, while moving the meeting point from Cloudflare Workers / Durable Objects to a dedicated Go service hosted on `relay.chatwithai.icu`.

## Problem

The remote control protocol v1 connects mobile clients to local DSH instances via `/ios/v1` over WebSocket. Today, all traffic for this origin is proxied through a third-party Cloudflare Worker (`market/worker/src/relay.js:8-12`), while lease management and bridge rendezvous are anchored on Cloudflare Durable Objects (`market/worker/src/relay-bridge.js:145-180`) and apex endpoints (`market/worker/src/relay-control.js:18-28`). The host-side plugin (`packages/dsh-remote-bridge`) binds strictly to hardcoded market apex endpoints (`packages/dsh-remote-bridge/src/host/relay-control.ts:17-18`) and fixed hostname templates (`packages/dsh-remote-bridge/src/host/relay-registry.ts:24-30`), dialling outbound connections to Cloudflare endpoints (`packages/dsh-remote-bridge/src/host/relay-bridge-connector.ts:109-113`).

This deployment topology encounters two hard operational failures:

- **Continuous 429 rate-limiting on Cloudflare Workers platform APIs.** The Cloudflare management plane repeatedly returns HTTP 429 on `workers/services` deployment calls, causing deployment pipelines to fail and blocking emergency fixes and version rollouts.
- **Third-party edge dependency for 100% of data plane bytes.** Relaying every real-time protocol frame through third-party Worker and Durable Object runtimes subjects session latency, long-lived WebSocket streaming, and concurrency to external platform quotas, maintenance cycles, and billing shifts.

## Non-Negotiable Constraints

Five boundaries are fixed by existing client contracts, security models, and production invariants:

- **Phone App code remains completely untouched.** The iOS client implementation in `RemoteKit` (the `iphone_remote_use_dsh` repository's `Remote/Sources/RemoteKit/ProtocolV1.swift:377` where `wsPath = "/ios/v1"`, and `Remote/App/AppModel.swift:354-367` where `normalise()` strips all path prefixes and preserves only scheme, host, and port) must not receive any modifications.
- **The existing dsh-market relay remains active in parallel.** The Cloudflare Worker relay is not shut down; both rendezvous transports coexist so unmodified desktop hosts and existing installations keep functioning normally.
- **Default host configuration behavior is verbatim identical.** The configuration parser (`packages/dsh-remote-bridge/src/index.ts:503-517`) supplies default values for `relayControlUrl` (`https://dsh-market.com/api/relay`) and `relayPublicSuffix` (`.dsh-market.com`) when omitted, preserving zero-config behavior.
- **Lease retry and backoff semantics remain strictly unchanged.** The retry decision function `relayClaimRetryOf` (`packages/dsh-remote-bridge/src/host/relay-control.ts:217-229`) must preserve terminal termination on 403, `refreshIdentity` on `invalid-params` or `unknown-id`, `retryAfterMs` floor elevation, and exponential backoff capped between 5s (`CLAIM_RETRY_BASE_MS = 5_000`) and 300s (`CLAIM_RETRY_MAX_MS = 300_000`).
- **Browser remote interface stays untouched.** The retired web UI package `dsh-remote-web-ui` receives zero modifications, and the host-side bridge plugin retains all existing ingress gate boundaries.

## Transport Options Compared

Three implementation paths were evaluated against deployment feasibility, residential network constraints, and vendor independence:

| Option | Architecture | Feasibility and Failure Condition | Verdict |
| --- | --- | --- | --- |
| Reverse proxy to host loopback | Direct inbound proxy from VPS to host network | Fails in residential environments without public IP, port forwarding, or reliable NAT traversal | Rejected |
| Migrate control plane only | Host lease on VPS, leave WSS bridge on Worker | Leaves data plane 100% on Cloudflare Workers; deployment 429 errors and traffic quotas persist | Rejected |
| Go self-hosted rendezvous meeting point | Outbound WSS dial from Mac, WSS connection from phone | Reliable outbound traversal, complete vendor independence, full multiplexed bridge contract compatibility | Selected |

## Selected Architecture

The selected design implements an autonomous WebSocket rendezvous bridge daemon in Go within the `iphone_remote_use_dsh` server repository, sitting behind an existing Nginx ingress on the self-hosted VPS (`43.153.135.11`).

### Process and Port Topology

The relay service is implemented as an independent command under `Server/go/cmd/relayservice`, compiled into a standalone binary `whale-relay` (`/opt/whale-go/relay/whale-relay`). It is supervised by a dedicated systemd unit `whale-relay.service` and listens exclusively on local loopback `127.0.0.1:18789`. It operates completely isolated from the existing account service (`whale-account-go.service`, listening on `127.0.0.1:18787`). Restarting or updating the account service never disrupts in-flight long-lived relay sessions or connector tunnels.

### Nginx Reverse Proxy and TLS Certificate

A DNS-only (grey cloud) A record routes `relay.chatwithai.icu` and `*.relay.chatwithai.icu` directly to `43.153.135.11`. The Nginx virtual host terminates TLS on port 443 with a wildcard certificate whose Subject Alternative Name (SAN) contains both `relay.chatwithai.icu` and `*.relay.chatwithai.icu`. Nginx proxies both hostnames to `127.0.0.1:18789`:

- Apex domain `relay.chatwithai.icu`: routes HTTP control plane requests (`/v1/relay/*`) and upstream connector WebSocket connections (`/__relay/connector`).
- Wildcard subdomain `<id>.relay.chatwithai.icu`: routes downstream client WebSocket requests (`/ios/v1`). Subdomains are strictly required because `Remote/App/AppModel.swift:354-367` (`normalise()`) in the `iphone_remote_use_dsh` repository discards all URL paths and retains only scheme, host, and port.

### SQLite Lease Ledger

The daemon maintains state in an isolated SQLite database at `/var/lib/whale-go/relay.db`. The lease schema tracks instances and authentication credentials:

```sql
CREATE TABLE IF NOT EXISTS relay_leases (
  id TEXT PRIMARY KEY,
  secret_sha256 TEXT NOT NULL,
  hostname TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'bridge',
  created_at INTEGER NOT NULL,
  claimed_at INTEGER NOT NULL,
  released_at INTEGER,
  plugin_version TEXT
);
CREATE INDEX IF NOT EXISTS idx_relay_leases_claimed_at ON relay_leases(claimed_at);
```

A periodic garbage collection routine executes every 24 hours, purging inactive leases where `claimed_at < unixepoch() - (90 * 86400)`.

## Control Plane Contract

The control plane implements lease acquisition and voluntary release under apex domain `https://relay.chatwithai.icu`.

### Endpoints

Two endpoints govern the lease lifecycle:

- `PUT /v1/relay/claim`: Claims or refreshes a lease for a relay instance.
  - Request body (JSON):
    - `id` (string, required): 16-character hexadecimal instance identifier matching `/^[a-z0-9]{16}$/`.
    - `secret` (string, required): 43-character base64url credential matching `/^[a-zA-Z0-9_-]{43}$/`.
    - `new_secret` (string, optional): Provided only during initial registration or identity refresh.
    - `origin` (object, required): `{ "port": number }` containing local web server port.
    - `plugin` (object, optional): `{ "version": string }` recording host bridge version.
  - Response body (JSON, 200 OK):
    ```json
    {
      "mode": "bridge",
      "hostname": "<id>.relay.chatwithai.icu",
      "bridge": {
        "endpoint": "wss://relay.chatwithai.icu/__relay/connector",
        "instance": "<id>",
        "credential": "lease-secret"
      }
    }
    ```
- `POST /v1/relay/release`: Marks an active lease as released upon graceful host shutdown or unmount.
  - Request body (JSON): `{ "id": "<id>", "secret": "<secret>" }`.
  - Response body (JSON, 200 OK): `{ "ok": true }`. Sets `released_at = unixepoch()` in SQLite.

### Error Codes and Retry Decisions

Errors returned by the control plane directly map to the host-side retry decisions executed by `relayClaimRetryOf` (`packages/dsh-remote-bridge/src/host/relay-control.ts:217-229`):

| HTTP Status | Error Body | Cause | Host Retry Behavior |
| --- | --- | --- | --- |
| 400 | `{"error":"invalid-params"}` | Malformed JSON or invalid regex format | Triggers `refreshIdentity: true`, re-registers with new credentials |
| 403 | `{"error":"auth-failed"}` | Secret SHA-256 mismatch against stored lease | Terminal refusal (`retry: false`), stops dial loop |
| 404 | `{"error":"unknown-id"}` | Unclaimed instance without `new_secret` | Triggers `refreshIdentity: true`, re-claims fresh identity |
| 429 | `{"error":"rate-limited"}` | IP or ID request rate limit exceeded | Retries with capped exponential backoff (5s to 300s) |

### Scope Boundary

The endpoints `/v1/relay/register` and `/v1/relay/unregister` are intentionally not implemented. The legacy quick-tunnel proxy mode remains permanently on `dsh-market.com`; the self-hosted relay only serves `mode: 'bridge'`.

## Data Plane Contract

The data plane delivers low-latency bidirectional multiplexing between downstream phones and upstream host connectors.

### Downstream Handshake and Path Filtering

A mobile client establishes WebSocket communication at `wss://<id>.relay.chatwithai.icu/ios/v1`. The server strictly enforces path whitelisting:

- Only exact HTTP Upgrade requests for `/ios/v1` are accepted into the bridge.
- All other HTTP requests, query variations outside `/ios/v1`, or mismatched paths immediately return HTTP 404 Not Found without dialling the upstream connector.
- The server performs no authentication against phone clients: it functions as a transparent protocol pipe. Device tokens and one-time pairing bootstrap tokens are verified end to end on the host instance (`packages/dsh-remote-bridge/src/index.ts:6-12`). Account subscription tiers do not gate transport paths (the `iphone_remote_use_dsh` repository's `docs/account-and-subscription.md:24,226-238`).

### Upstream Connector Bridge

The desktop host dials an outbound WebSocket connection to `wss://relay.chatwithai.icu/__relay/connector?id=<id>`. Authentication and process isolation follow these rules:

- **Credential header:** The connector presents `Authorization: Bearer <secret>` carrying the raw lease secret (`packages/dsh-remote-bridge/src/host/relay-bridge-connector.ts:141-149`), verbatim identical to today's host handshake headers with only the dial endpoint URL modified.
- **Elimination of internal marker header:** The header `x-relay-bridge-attach` (`market/worker/src/relay.js:31` and `market/worker/src/relay-bridge.js:171,570`) is omitted in this architecture. In the Cloudflare Worker architecture, the Worker door terminates the client handshake, verifies credentials, strips authorization and cookies, and stamps `x-relay-bridge-attach: 1` before forwarding to the internal Durable Object. In the self-hosted Go service, the HTTP door and the rendezvous bridge live inside the same single process with no internal trust boundary. Connector attachments and downstream client connections are strictly isolated by distinct hostnames (`relay.chatwithai.icu` vs `<id>.relay.chatwithai.icu`), distinct paths (`/__relay/connector` vs `/ios/v1`), and lease credential verification, so no internal marker header is needed.

The server extracts `<id>` from the query parameter, computes the SHA-256 digest of `<secret>`, and executes a constant-time comparison against `secret_sha256` in `relay_leases`. If valid, the WebSocket upgrade is accepted; otherwise, it is refused with HTTP 403.

### Multiplexed Frame Contract

The frame contract mirrors `market/worker/src/relay-bridge.js` verbatim across the single connector socket:

- **Control frames (JSON text):**
  - Inbound/Outbound: `req` (start HTTP request), `res` (HTTP response head), `fin` (end HTTP response stream), `fail` (stream error), `ws-open` (phone WebSocket handshake), `ws-accept` (connector accepts upgrade), `ws-fail` (connector refuses upgrade), `ws-close` (phone/connector closes socket), `close` (cancel stream), `end` (end request body).
- **Payload frames (Binary):** `[kind:u8][streamId:u32be][payload]`
  - `kind = 1`: HTTP body chunk.
  - `kind = 2`: WebSocket binary frame.
  - `kind = 3`: WebSocket UTF-8 text frame.
- **Timeouts:** Response head timeout is 60 seconds (`HEAD_TIMEOUT_MS = 60_000`); WebSocket handshake acceptance timeout is 15 seconds (`WS_OPEN_TIMEOUT_MS = 15_000`).
- **Header filtering:** Hop-by-hop headers (`connection`, `keep-alive`, `transfer-encoding`, `upgrade`, `content-length`) are dropped from upstream responses before delivery to downstream clients.
- **Transport marker:** Bridged responses inject `x-relay-transport: bridge`.

### Reconnect Semantics

When a host restarts or reconnects with the same `id`:

- The newest connector attachment wins immediately.
- The daemon closes the superseded connector socket with WebSocket close code `1000 replaced` (`market/worker/src/relay-bridge.js:200`).
- All active streams owned by the replaced socket are immediately terminated with reason `connector-replaced` (`market/worker/src/relay-bridge.js:198`).
- Streams newly established on the new socket continue without interruption.
- The host connector retries with exponential backoff between 1s (`BRIDGE_RETRY_BASE_MS = 1_000`) and 30s (`BRIDGE_RETRY_MAX_MS = 30_000`), using its persistent secret without requiring new tickets.

### Rate Limiting and Stream Concurrency

To protect server memory and network buffers against abuse:

- **Lease claim limit:** The new service configures dedicated rate-limiting windows for claim requests, following the same magnitude as the control plane in `market/worker/src/relay-control.js:453-454`: maximum 30 requests per 60 seconds per IP, and 6 requests per 60 seconds per instance ID.
- **Connector attach limit:** Maximum 30 connections per 60 seconds per IP, and 6 connections per 60 seconds per instance ID, defined specifically for the new service to guard socket allocations.
- **Concurrent streams per instance (new gate in this design):** A hard limit of 64 concurrent active streams per connector, newly introduced in this self-hosted design to prevent memory and socket buffer exhaustion. Excess connections return HTTP 429 or are rejected with `ws-fail`.

## Capacity and Resource Ceilings

Moving the rendezvous bridge onto a self-hosted VPS shifts all network bandwidth and compute responsibilities to a single host.

### Resource Assumptions

The capacity plan models typical fleet utilization based on production telemetry:

| Dimension | Baseline Assumption | Defeat Metric |
| --- | --- | --- |
| Concurrent active instances | 50 to 100 concurrently connected desktop hosts | Active TCP sockets on port 18789 exceeding 500 |
| Memory per idle connection | 15 KB to 25 KB per socket buffer in Go runtime | RSS of `whale-relay` exceeding 512 MB |
| Streaming bandwidth per active session | 20 KB/s to 100 KB/s during streaming token inference | VPS egress traffic exceeding 80 Mbps sustained |
| Database transaction rate | Under 5 write transactions per minute across fleet | SQLite write latency exceeding 50 ms |

### Capacity Ceilings and Bottlenecks

The performance boundaries are evaluated against VPS hardware constraints:

- **Egress bandwidth is the first bottleneck.** On a standard 100 Mbps uplink, 50 simultaneous active streaming sessions require approximately 20 to 30 Mbps, leaving ample headroom. However, massive burst file downloads could saturate egress; streaming responses should stay within reasonable rate limits.
- **Compute and memory footprint are negligible.** Go epoll-based network polling handles thousands of concurrent idle WebSockets with minimal CPU utilization. SQLite operations occur only on startup claim or release, leaving the database idle during message streaming.

## Migration and Deployment Path

Migration executes through an ordered sequence of isolated stages to eliminate accidental service disruptions.

### Cutover Order

1. **Deploy relay daemon on VPS:** Compile `whale-relay`, install systemd unit `whale-relay.service`, initialize `/var/lib/whale-go/relay.db`, and configure Nginx vhost with wildcard certificate for `*.relay.chatwithai.icu`.
2. **Expose configuration options in host bridge:** Add `relayControlUrl` (default `https://dsh-market.com/api/relay`) and `relayPublicSuffix` (default `.dsh-market.com`) to `packages/dsh-remote-bridge/src/index.ts`.
3. **Verify on independent probe instance:** Launch an isolated DSH probe host with dedicated `DSH_HOME=/tmp/dsh-verify-relay` pointing to `relay.chatwithai.icu`, verifying handshake, streaming, and approval waterfall.
4. **Update production user profile:** Edit production profile configuration to set `relayControlUrl: https://relay.chatwithai.icu/v1/relay` and `relayPublicSuffix: .relay.chatwithai.icu`.
5. **Restart DSH host:** Restart the production `dsh web` instance to load the updated profile settings.
6. **Switch phone app origin:** In the iOS App Connection settings, update stored origin to `wss://<id>.relay.chatwithai.icu` and reconnect.

### Rollback Strategy

If an unexpected defect occurs, rollback requires two straightforward configuration edits:

- On the desktop host, revert `cordis.patch.yml` to remove the custom relay options (falling back to `dsh-market.com`), then restart `dsh web`.
- On the phone client, open Connection settings, edit origin back to `wss://<id>.dsh-market.com`, and tap reconnect.

### The Irreversible Step

This design contains **zero irreversible steps**. Both `dsh-market.com` and `relay.chatwithai.icu` operate simultaneously. No DNS zones are deleted, no Cloudflare routes are modified, and no certificates are destroyed. Rolling back is an instant origin swap on both ends.

## Verification and Grey Release

Verification is strictly conducted in isolation before touching real user environments.

### Probe Host Verification

All validation is performed using an ephemeral probe instance with `DSH_HOME=/tmp/dsh-verify-relay`. This ensures the active session's task board ledger and running desktop host are never disturbed.

### Three Core Verification Links

The grey release passes if and only if all three core workflows succeed on the probe instance:

- **Pairing bootstrap flow:** Verify `/ios/v1` handshake with a fresh one-time bootstrap token generated from `http://127.0.0.1:<port>/remote-bridge/pair/token`. Successful exchange of `pair.begin` and `pair.finish` over the self-hosted relay confirms zero regression on the pairing gate.
- **Session streaming flow:** Verify `session.snapshot` and `session.prompt` streaming message delta frames. Incremental chunks must arrive sequentially without buffering, disconnection, or corrupted JSON frames.
- **Approval request waterfall:** Trigger a tool call requiring confirmation (`approval/request`). The request must be forwarded to the mobile client as an approval card, and human confirmation on the client must resolve the model call in the host.

### Timing and Telemetry

The verification run measures and logs two operational durations:

- **Cutover elapsed time:** Measured from applying configuration to the first successful ping from the mobile client over `relay.chatwithai.icu`.
- **Rollback elapsed time:** Measured from restoring `dsh-market.com` configuration to the successful reconnect of the mobile client.

## Consequences and Trade-offs

This architectural transition introduces operational responsibilities that must be acknowledged:

- **Single point of failure on the VPS.** The self-hosted server (`43.153.135.11`) becomes the sole relay hop for migrated instances. If the VPS suffers an outage, relaying stops until restored. Mitigation is provided by keeping `dsh-market.com` as an active fallback.
- **Wildcard TLS certificate maintenance.** The `*.relay.chatwithai.icu` certificate requires periodic renewal via Let's Encrypt DNS-01 challenges. Automated cron hooks or Certbot scripts must be maintained to prevent certificate expiry.
- **Manual client origin reconfiguration.** Because the iOS client stores a single connection origin, migrating an existing user requires manually updating the server address in the client Connection settings.

## Operational Safety and Known Hazards

A critical operational hazard exists in the execution sequence:

- Modifying the host profile configuration requires restarting the `dsh web` host process for new options to take effect.
- Restarting the active `dsh web` process terminates the agent session currently orchestrating this task, severing the execution context.
- Consequently, modifying the production user profile and restarting the host must strictly be placed as the final step after all server deployment, code implementation, and probe testing are fully accepted.

