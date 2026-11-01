# Agent Note: Relay Transport v2 - a Durable Object Rendezvous Bridge With the Worker Left at the Door

Status: proposed

This note supersedes the [named-tunnel relay proposal](2026-10-23-relay-named-tunnel-data-plane.md): three production readings on 2026-10-23 overturned its transport choice, so the choice is redone here, while the control-plane contract it already shipped (lease, claim/release/retire) is carried forward as a reusable asset rather than as a dead draft.

The landing record is [the additive relay bridge](2026-10-23-relay-bridge-additive-implementation.md): the per-instance `mode`, the long-lived credential and socket replacement on the object are merge-ready code, not deployed yet.

The rendezvous meeting point is moved to the self-hosted relay.chatwithai.icu in [self-hosted relay meeting point](2026-11-01-selfhosted-relay-meeting-point.md); the frame contract and capacity model are carried forward there, while this note's remaining conclusions remain valid.

## Problem

A paired phone reaches its DSH instance at `https://<id>.dsh-market.com`, and every byte of that origin is served by the market Worker (`market/worker/src/relay.js`): the Worker reads one D1 row holding the instance's current `*.trycloudflare.com` quick-tunnel hostname and forwards the request through it. The origin transport is therefore a quick tunnel, and the official documentation classifies quick tunnels as a testing facility: no uptime guarantee, at most 200 in-flight requests per tunnel (excess answers `429`), no Server-Sent Events, and a hostname that changes on every restart ([Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)).

This is not a tidy-minded complaint. The plugin's own remote channel emits SSE (`text/event-stream` in `packages/dsh-remote-web-ui/src/routes.ts`), so the streaming path of the product runs today over a transport whose documentation says SSE is unsupported, and the only thing behind it is the Worker's offline page.

## How the Three Readings Rewrite the Goal

The three production readings of 2026-10-23 are hard constraints, not open hypotheses. Together they invalidate not only the previous note's means but its goal sentence.

| Reading | Observation | What it invalidates |
| --- | --- | --- |
| Scale | `relay_registrations` shows 3,390 active in 24 hours, 6,641 in 7 days, 10,366 in 30 days and 12,215 in total (this note's read-only recheck is in section 6) | Any cutover that switches every instance in one deployment: it cuts every active instance in the same second and every phone has to rescan from the desktop |
| Quota | The account's Cloudflare Tunnel quota is 1,000 ([Account limits](https://developers.cloudflare.com/cloudflare-one/account-limits/); the read-only query in this session found 1 tunnel in the account) | One named tunnel per instance: 6,641 active instances do not fit, and the purchase price is in the arithmetic of section 6 |
| Precedence | After building `<id>.dsh-market.com` as an exact proxied CNAME to `<uuid>.cfargotunnel.com`, the request was still answered by the wildcard Worker custom domain (the host's 401) | The goal "the data plane never crosses the Worker": on `<id>.dsh-market.com`, as long as that hostname is preserved, the answerer is that wildcard custom domain |

The goal sentence is therefore rewritten as: **the Worker stays at the door as a stateless, thin proxy, and the origin transport becomes a rendezvous bridge that consumes no account quota and carries an availability promise.** The only known way to take the Worker out of the data plane is narrowing the wildcard route, which is exactly what the first reading kills; this design therefore touches no route, no DNS record and no certificate, and migrating one instance is a single state column.

## Non-Negotiable Constraints

- The stable hostname `<id>.dsh-market.com` is preserved: it is what the phone stores, and changing the origin means re-pairing every phone.
- The security model is unchanged: the plugin mints id and secret on first run, the server stores only the secret hash and compares it in constant time, registration origins stay restricted, and the Worker never terminates the pairing flow.
- The live fleet must not break: no step may cost any of the 3,390 instances active in 24 hours its hostname, and the rollback window is one instance wide.
- Both ends of the target user are in the United States: edge placement and ocean crossings are not design inputs, and this note cites no trade-off justified by distance.
- This change performs zero production writes: no deployment, no tunnel creation or change, no DNS write, no route or certificate change, no API token creation.

## Transport Options Compared

Four candidates, compared by cost, capacity ceiling and defeat condition.

| Option | Cost | Capacity ceiling | Defeat condition | Verdict |
| --- | --- | --- | --- | --- |
| A The plugin opens an outbound WebSocket to a Durable Object and the Worker pairs the phone's HTTP and WSS with that bridge | We own a minimal frame protocol (request headers, request body, response headers, response body, phone WS events), a few hundred lines on each side | Objects per account unlimited, 1,000 requests/s soft per object, 32 MiB received WebSocket frame, 10 GB storage per object ([Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)) | If a Durable Object cannot serve an HTTP streaming response while it holds the plugin socket, or if the undocumented sockets-per-object cap is low | Selected |
| B A self-hosted or multi-node relay (VPS or self-controlled edge) that leaves Cloudflare Tunnel entirely | On-call duty, DDoS exposure, egress bill (about 3.6 TB/month at Band A in section 6) | Sockets and bandwidth per machine; availability needs several machines plus anycast | If round-the-clock duty and egress traffic are acceptable | Rejected, kept as the vendor-independent fallback |
| C Keep the quick tunnel but harden it (supervision, protocol, observability) | No new infrastructure | 200 in flight per tunnel, no SSE, no uptime guarantee, hostname changes every restart (same quick-tunnel page) | If the platform gives quick tunnels an availability promise and SSE support | Rejected, demoted to the permanent fallback |
| D Named tunnels plus purchased Tunnels for Platforms capacity (the previous note with a ticket bought) | 6,641 active instances need 5,641 extra tunnels at $4.50 each per month ([Tunnels for Platforms](https://developers.cloudflare.com/tunnel/features/tunnels-for-platforms/)) | 1,000 included plus purchased capacity | If the per-instance tunnel price fell to a few cents | Rejected, see the arithmetic in section 6 |

The facts behind that table, each taken from current official documentation: a Durable Object accepts received WebSocket frames up to 32 MiB with 1,000 requests/s soft per object, unlimited objects per account and 10 GB per object; the Workers side accepts the same 32 MiB frame and closes an oversized one with `1009` ([Workers WebSockets](https://developers.cloudflare.com/workers/runtime-apis/websockets/)); the Workers Paid plan includes 10 million requests per month, charges $0.30 per additional million and charges nothing for egress or bandwidth ([Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)); Durable Objects include 1 million requests per month, charge $0.15 per additional million, include 400,000 GB-s, charge $12.50 per additional million GB-s while billing each active object as 128 MB, bill inbound WebSocket messages at a 20:1 request ratio, charge nothing for outbound messages or protocol-level pings, and charge no duration for an idle object that is eligible for hibernation ([Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)); the hibernation API lets an object be evicted from memory while keeping its sockets, and duration billing does not accrue while it hibernates ([Use WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)); the same Limits page states that an HTTP or RPC call has no hard wall-time limit while the caller stays connected, so one long SSE stream is not cut by a duration cap ([Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)).

## The Selected Design

One Durable Object namespace, one object per relay instance, with the object name derived from the instance id (`idFromName(id)`), so the Worker needs no lookup table to reach the bridge.

### Request Path

A phone request still lands on `<id>.dsh-market.com` and is delivered to the market Worker by that wildcard route. The Worker widens the D1 read it already performs to `target, mode`; when `mode` is `bridge` it hands the whole Request to `env.RELAY.get(idFromName(id)).fetch(request)`, and when it is `quick` it takes today's quick-tunnel branch. On the object side: with no live plugin socket it answers `409 no-connector` and the Worker falls back to the quick branch inside the same request; with a socket it allocates a stream id, sends the request headers as one frame, writes the plugin's response body chunks into a `ReadableStream` and returns that as the Response to the Worker.

### Frame Contract

Control frames are JSON text, body chunks are binary, and streams are multiplexed by stream id on one socket.

| Direction | Frame | Payload | Meaning |
| --- | --- | --- | --- |
| Object to plugin | `req` | `id`, `method`, `url`, `headers` | Start of one HTTP request |
| Object to plugin | `body` / `end` | `id` plus a binary chunk, or just `id` | Request body chunk and its end |
| Plugin to object | `res` | `id`, `status`, `headers` | Response headers, before any body chunk |
| Plugin to object | `chunk` / `fin` | `id` plus a chunk of at most 256 KiB, or just `id` | Response body chunk and its end |
| Both ways | `ws-open` / `ws-frame` / `ws-close` | `id` plus the frame content | The three phone WebSocket events |
| Both ways | `close` | `id`, `reason` | Either side cancels or the upstream drops |

Keepalive rides WebSocket protocol-level ping rather than application frames, because protocol pings are not billed while application messages are billed at 20:1. Backpressure is one in-flight byte cap per stream (1 MiB initially): past it the plugin stops reading the origin socket, and the object pauses enqueueing on `desiredSize`.

### Fallback and Authentication

The bridge socket is authenticated before the upgrade with the same id/secret check the registration endpoint uses (hash comparison, per-IP and per-id windows, origin restriction); only after it passes does the Worker forward that Upgrade request to the instance's object. The object therefore only ever sees a connection the Worker already accepted, and the object name is derived from the id alone, so it is unreachable across instances. Every phone-side credential (the pairing cookie) crosses the bridge end to end and is never touched by the object, exactly as the Worker forwarding path treats it today: the trust boundary does not move, because Cloudflare already terminates the phone's TLS and sees the request.

**Non-negotiable: the connector never rewrites `Host`.** The bridge must deliver the phone's `Host` to the host verbatim, as the public origin literal. The host builds its local control plane on two conditions — the socket address and `Host` both naming this machine — and a tunneled request already arrives from loopback, so that header is the only discriminator left. The shadow flight measured it: with the connector rewriting `Host` to `127.0.0.1:55220`, `/remote-bridge/pair/token` answered `200` with a usable 30-second pairing token from the public origin, while the production relay answers `403` on the same path (`the request names a Host that is not this machine`); forwarding the header unchanged restored `403`. That gate covers more than the token endpoint — it covers the whole local control plane: `/remote-bridge/pair/token`, `/api/pair/*`, `/api/update/*`, `/api/plugin-manager`. "The trust boundary does not move" therefore holds only while the connector leaves `Host` alone, which makes this an implementation constraint rather than an implementation detail.

**The shape of the reconnect credential must be named here, not left to the implementation.** If the bridge socket upgrade uses a one-time ticket and the object writes "ticket spent" into its own durable storage, then one reconnect needs a fresh ticket **and** a fresh object (a new instance id): the shadow-flight probe found exactly that, a new ticket alone was not enough and the instance had to change too. That conflicts head on with "a release means every socket reconnects". The design has two options: mint a ticket per connect (decoupling the ticket from the instance lifetime, which needs an issuance channel before every reconnect), or upgrade with a long-lived credential and replace the old socket object-side (the same object accepts the new connection and closes the old one). Neither has been verified, and the shadow flight **did not measure reconnection**: that is this design's open gap.

Fallback has three layers, all one instance wide: the same request falls back to quick when the object has no socket; flipping `mode` sends a whole instance back to quick; and a plugin without the bridge, or whose bridge cannot connect, keeps running the quick connector, because both connectors coexist during the migration.

### Observability

Every bridged request carries `x-relay-transport: bridge` plus the forwarded `cf-ray`, and a fallback carries `x-relay-fallback: no-connector`; on the plugin side the connector writes its state, instance, endpoint, local upstream and last dial error into `$DSH_HOME/remote-web-ui-relay-bridge.json`, because the Desktop host runs the plugin in a process whose stdout nobody reads (2026-10-23: a host that never claimed answered `no-connector` for its whole life with no readable trace); the object samples `getWebSockets().length` once a minute for the online count; disconnect reasons (`deploy`, `network`, `evicted`) go to structured logs through the observability already enabled in `wrangler.jsonc`. Every Workers release disconnects existing WebSockets once the grace period ends (the runtime-update grace section of [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)), so the bridge must assume that a release means every socket reconnects, with the capped backoff the plugin's `RelayRegistrar` already implements.

## Capacity and Cost Arithmetic

### Measured Readings

Only read-only queries were used, with commands and results in section 8; the four numbers the model needs are 3,390 active in 24 hours, 6,641 active in 7 days, 12,215 in total, and 6,167,775 D1 read queries in 24 hours.

### Assumptions

| Assumption | Value | Defeat condition |
| --- | --- | --- |
| Peak concurrent online instances | 1,200, with 300 overnight | Phase 3 samples `getWebSockets().length`; exceeding 3,390 (the 24-hour ceiling) means the model is wrong |
| Relay request volume, Band B | 1.5 million per day (about 17 rps fleet-wide) | Take relay requests per hostname from the analytics API; today's 6.17M read queries include the telemetry dashboard |
| Relay request volume, Band A | 6 million per day (about 70 rps, i.e. all D1 read queries attributed to the relay) | Same probe as above |
| Object wake time per request | 0.20 s (two edge-to-plugin round trips) | Phase 3 measures it with `wrangler tail` and in-object timing |
| Inbound WS messages per request | 3 frames (`res` plus two `chunk` plus `fin`, rounded) | Same probe as above |
| Average response bytes | 20 KB (assets already carry the Worker's immutable cache stamp) | A sampled response-size distribution |
| Throughput cost of one extra hop on large responses | Every bridged response takes one more hop (object to connector): a 300 KB response measured +345 ms (457 to 803 ms) | That instance's response-size distribution; if asset caching keeps large bodies in the Worker, the term only applies to large `/ios/v1` frames |

### Two Traffic Bands

| Item | Band B: 1.5 million per day | Band A: 6 million per day |
| --- | --- | --- |
| Object requests (including the 20:1 ratio and connection setup) | About 52 million per month, $7.66 | About 207.3 million per month, $30.95 |
| Object duration (0.20 s times 128 MB) | 1,152,000 GB-s, $9.40 | 4,608,000 GB-s, $52.60 |
| Worker requests (already paid today) | 45 million, $10.50 | 180 million, $51.00 |
| Monthly total | About $28, the tens-of-dollars order | About $135, the hundreds-of-dollars order |

For comparison, the previous note's ticket-purchase variant needs 5,641 extra tunnels for 6,641 active instances, so $4.50 times 5,641 is **$25,385 per month**, and counting all 12,215 historical instances it is **$50,468 per month**. The bridge's incremental cost at Band A ($83.55 per month) is therefore about 300 times cheaper than buying tunnel capacity, and its Band B increment ($17.06 per month) about 1,500 times cheaper.

Both bands above model "requests times wake time", and that model covers latency but not throughput: every bridged response takes one more hop than the quick path (object to connector), and the cost lands on moving the body rather than on the round trip. In the shadow flight, same hour and same tool, pure round trips differed by 7 to 11 ms (hello 151.6 against 144 ms, `session.titles` 150.3 against 139.6 ms), while a roughly 300 KB text `session.list` went from 457 ms to 803 ms (+345 ms). So besides the Band A/B bill there is a throughput term — one extra hop on large responses — that changes no object request count or duration but decides user-visible latency on large frames (session baselines, the roster), and both the compression ratio and asset caching move it.

### The First Ceiling Hit

The object count equals the migrated instance count: 6,641 instances active in 7 days map to at most 6,641 objects and objects per account are unlimited, so one object per instance puts no pressure on that dimension. After sharding, the 500-class cap uses 1 class, the 1,000 requests/s soft per object is untouched at 70 rps, 10 GB per object stores a few hundred bytes, the 32 MiB frame limit sits far above a 256 KiB chunk and the 6 outbound connections per request use 1, so **the first thing actually hit is no hard quota at all but the duration bill**: it grows linearly with requests times wake time, and Band A's duration line already costs about seven cents an hour. The second is the Worker request fee, which the fleet pays today and which is therefore not new. The one thing phase 3 must measure is the **sockets-per-object ceiling**, a soft constraint with no documented number: this design holds one plugin socket plus a few phone sockets per object, and if two sockets already flap, that is what bites first.

## Migration Path

### Cutover Order

1. Deploy additively: the object namespace, the `/api/relay/bridge` upgrade endpoint, and a `mode` column on `relay_registrations` defaulting to `quick`. The Worker's request path reads one more column and behaves byte for byte as it does today.
2. Publish the plugin with the bridge connector: it opens one outbound WebSocket and still starts the quick connector; the server only records that the bridge exists and switches no instance. The claim that carries the bridge grant is transport-owned: it runs whenever the relay is on and the web server port is bound, not only when a quick tunnel starts, so a bridge-served instance reaches its object with `autoTunnel` off (2026-10-23: a desktop host whose profile resolved `autoTunnel: false` never claimed, the object held no socket and the edge answered `x-relay-fallback: no-connector` until the claim was decoupled). If this step uses a one-time ticket whose spent mark the object keeps in storage, the first release after it loses every connection with no way back (see Fallback and Authentication), so the shape of the reconnect credential has to be settled before step 1.
3. Flip `mode` per instance (1% first, then in batches by `last_seen_at`); the Worker takes the bridge when `mode=bridge` and the object holds a socket, and takes quick otherwise. Each batch is one D1 UPDATE that takes effect in seconds.
4. New plugin versions stop opening a quick tunnel by default and only start it on demand when the bridge is unavailable; instances on older plugin versions are untouched and keep using the quick path indefinitely.
5. An optional and last-possible cleanup: delete the quick path, meaning the `relay_registrations` rows, the proxy branch in `relay.js`, the `--http-host-header` wiring and the plugin's quick connector.

### Rollback

Flipping `mode` back to `quick` is the rollback, for one instance, one batch or the whole fleet: one D1 UPDATE, no redeployment, no plugin restart, no DNS, no route, no certificate, and nothing the phone can observe. The plugin-side second rollback is to disable the bridge connector, which only affects its own socket while the quick connector keeps serving.

### The Irreversible Step

Only step 5 is irreversible: once the quick path is deleted, an instance running an older plugin, or sitting behind a network that blocks outbound WebSockets, has no transport at all. That is why it comes last and is gated on the share of older versions falling below an acceptable threshold. By contrast the previous design's route narrowing was an irreversible **global** act, and this design removes it entirely: nothing in the data plane of this design is irreversible.

## The Minimal Falsifiable Experiment

### Phase 0: Read-Only Readings (Already Run)

| Probe | Command | Reading | What it settled |
| --- | --- | --- | --- |
| The zone's route table | `GET /zones/{zone_id}/workers/routes` | One `*.dsh-market.com/*` pointing at `dsh-market` | A single route answers every relay hostname, so narrowing it is a global cut |
| Tunnels in the account | `GET /accounts/{account_id}/cfd_tunnel?is_deleted=false` | One `dsh-relay-...`, status inactive | Quota is 999 free, one order of magnitude short of 6,641 active instances |
| Active windows | D1 `SELECT count(*) ... last_seen_at` over millisecond windows | 3,390 in 24 hours, 6,641 in 7 days, 10,366 in 30 days, 12,215 in total | The scale reading rechecks; a single-switch cutover cannot be safe |
| Start rate | Same query over 5 minute, 15 minute, 1 hour and 6 hour windows | 139, 303, 591, 1,018 | These count tunnel starts, not online instances (the table is only written on start), so concurrency needs its own probe |
| D1 volume over 24 hours | `wrangler d1 info dsh-market` | 6,167,775 read queries, 318,640 writes, 171,987,137 rows read, 5.13 GB database | Supplies Band A's order of magnitude: even attributing every read query to the relay gives 6 million per day |
| Analytics API | GraphQL `workersInvocationsAdaptive` | Returned `code: budget` (a rate limit, not an auth refusal) | Relay-only request count is still missing; it is the outstanding Band B reading |

### Phase 1: Local Rendezvous Bridge (Already Run)

Zero production writes: a throwaway project with one object and one handler ran under `wrangler dev --local` on this machine, the plugin side was played by a Node script, and all three readings passed.

| Check | Command | Reading | Failure meaning |
| --- | --- | --- | --- |
| A streaming response crosses the object | `node client.mjs` against `/probe` | Chunks arrived at 12, 211, 507 and 611 ms with `content-type: text/event-stream` | If they arrived in one block, the object buffered the SSE and the option is dead |
| A `stub.fetch` is served while the object holds the plugin socket | Same run | `200`, not `503 no-connector` | A `503` would mean the request evicts the object holding the socket, and the option is dead |
| A phone WebSocket round-trips through the object and the plugin | Same run | `phone received: pong:ping-1` | If nothing comes back, the phone's WS channel cannot be bridged and the option is dead |

This step proves the mechanism, not edge behaviour: frame limits, wake time and release reconnection all need the real edge in phase 3.

### Phase 2: Quota Invariants (Read-Only, Repeatable)

| Assertion | Command | Expected reading |
| --- | --- | --- |
| The bridge adds no Cloudflare Tunnel | `GET /accounts/{account_id}/cfd_tunnel?is_deleted=false` | The count is unchanged (currently 1) |
| The bridge changes no route | `GET /zones/{zone_id}/workers/routes` | Still exactly one `*.dsh-market.com/*` |
| The bridge writes no DNS record or certificate | `GET /zones/{zone_id}/dns_records?type=CNAME&name=<id>.dsh-market.com` | No per-instance record under relay hostnames |

### Phase 3: Non-Production Shadow Flight (Already Run, 2026-10-23)

Zero production writes: one probe Worker on `*.workers.dev`, one object sharded by instance id and a local connector, code in `probe/relay-bridge/` (branch `probe/relay-bridge-shadow`, commit `a453b6118`), removed with `wrangler delete` when the flight ended. The phone was an iPhone 17, same build, same DEBUG driver and same hour against the production path.

| Reading | Collection | Value | What it settled |
| --- | --- | --- | --- |
| Host gate | `GET /remote-bridge/pair/token` after the connector rewrote `Host` to a loopback literal | `200` plus a usable token; the production relay `403` on the same path | The connector must forward `Host` unchanged |
| Large-response throughput | Phone and desktop `session.list` (about 300 KB of text) | 457 to 803 ms | The extra hop costs throughput, not round trips |
| Streaming | `curl -N` against `/_probe/stream` | 5 chunks, 121 ms apart | The object does not buffer the response |
| Phone round trip | DEBUG driver | dial 763 ms, hello 200 ms, request rtt median 152.5 ms (production 1176 / 152 / 147) | At parity with the production path at the same caliber |
| Sockets per object | One object holding one connector and one phone socket | Steady for 95 s, largest single frame 1.45 MB, no eviction | Two sockets did not flap |
| First request 409 | The first `GET /` after a deployment | One `409 no-connector`, then 5/5 `401` | Unexplained; see Risks |
| Release reconnection | Not measurable in this flight | Not measured | A gap: the one-time ticket blocks reconnect, see Fallback and Authentication |
| The 32 MiB frame boundary | Largest observed frame 1.45 MB | Not approached | Still open |

The table below is what the design requires and its thresholds; the four items above are now readings and the rest still gate on it.

| Metric | Collection | Expected reading | Failure meaning |
| --- | --- | --- | --- |
| Wake time per request | In-object timing plus `wrangler tail` | Median 0.15 to 0.25 s | Beyond 0.5 s the duration bill doubles and Band A becomes hundreds of dollars |
| Sockets per object | `getWebSockets().length` sampled every 60 s | A steady 1 plugin socket plus phone sockets | If two sockets already flap or evict, the sharding strategy becomes one connection per object |
| Release reconnection | Deploy a new version and watch the plugin reconnect | Sockets drop within the grace period and all return within 30 s of backoff | If a large share never returns, the bridge needs a reconnection fuse |
| The 32 MiB frame boundary | The plugin sends a chunk near the limit | An oversized frame closes with `1009` | If it is refused far below 32 MiB, the chunk size must come down |

## Rejected Alternatives

**A self-hosted multi-node relay** is the only genuinely independent fallback: it moves the rendezvous point onto our own machines at the cost of on-call duty, DDoS exposure and an egress bill on the order of 3.6 TB per month, plus at least two machines and anycast for availability. Its protocol cost equals the selected option's (it needs the same frame contract), so it loses on cost and operations and only becomes the answer again under a requirement not to depend on one vendor.

**Hardening the quick tunnel** is not a live candidate but the permanent fallback this design keeps: it costs nothing, and none of its three official limits (200 in flight, no SSE, a hostname that changes on every restart) can be removed without replacing the transport. Keeping it is what makes "the old fleet never breaks" true in engineering terms.

**Named tunnels with purchased capacity** works on capacity and fails on price: $25,385 per month is the cheapest ticket, and it still faces the precedence reading, because an exact CNAME loses to the wildcard custom domain; so it would still have to add one global route narrowing, which is the most dangerous step of all.

**Replacing the Worker's D1 read with a KV cache** would save one D1 read per request, but it changes no transport decision and belongs outside this design; the readings after the bridge ships decide whether it earns its keep.

## Acceptance Criteria

- A migrated instance answers with `x-relay-transport: bridge` and no longer originates through a quick tunnel (no `trycloudflare` origin in the logs).
- Between two flips of `mode` on the same instance, the phone opens the same bookmark without re-pairing.
- Every `relay_registrations` row keeps a usable `target` until that instance has run on the bridge steadily for at least a week, so a whole batch can always go back to quick.
- The count returned by `GET /accounts/{account_id}/cfd_tunnel` does not grow because of the bridge during the whole migration.
- The median wake time per bridged request stays at or below 0.25 s and the Band A monthly bill stays below $200.
- Both streaming paths work on the bridge: `curl -N` sees incremental events and the phone's long-lived WebSocket stays up.

## Risks

- Owning the frame protocol is the main new burden: framing, backpressure, cancellation and reconnection are all ours to maintain, and a mistake surfaces on the phone as a blank page or a half response. The mitigation is to keep the contract to the frame classes in the table above and to pin each path with contract tests under the repository's test discipline.
- Every Workers release disconnects existing WebSockets after the grace period, so the bridge must assume a fleet-wide reconnection, and the fallback during it is the quick path. That conflicts with the cleanup in step 5, so the cleanup can only wait until the share of older plugin versions is low enough.
- The object duration bill grows linearly with traffic, and Band A is about five times Band B; there is no automatic brake, only the `mode` rollback and alerting. The metric to watch first is wake time per request, not request count.
- The sockets-per-object ceiling has no official number; if the real edge allows fewer than one plugin plus a few phone sockets, the sharding strategy changes, and that change reaches into the Worker's routing logic.
- The bridge requires the plugin to keep one outbound WebSocket open for a long time, so a corporate network that blocks WSS can only fall back to quick; that is a risk and also the reason this design is safer than the previous one.
- The first request after a deployment answered `409 no-connector` while the object demonstrably held the connector socket (the request before it was answered by the host and the four after it were served normally). The same-request quick fallback covers the outcome, but the cause is unexplained: object recreation at the edge while the socket survives is the leading suspicion, so it stays a measurement item rather than a resolved behaviour.

## Production Changes That Need Approval

1. Add the Durable Object namespace and the `/api/relay/bridge` upgrade endpoint, and add a `mode` column to `relay_registrations` (additive, changing no existing behaviour).
2. Publish the plugin version carrying the bridge connector, with both connectors running side by side.
3. Flip `mode` in batches, one D1 UPDATE each, rollbackable by the same means.
4. Run one phase 3 shadow flight on a non-production hostname (`*.workers.dev`) to measure wake time and the socket ceiling before choosing batch size.
5. Only after the share of older plugin versions falls below a threshold, discuss deleting the quick path; that is outside this note's approval.
