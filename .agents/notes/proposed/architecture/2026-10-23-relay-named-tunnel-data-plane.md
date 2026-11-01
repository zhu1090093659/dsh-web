# Agent Note: Named-Tunnel Relay So the Data Plane Never Rents the Worker

Status: proposed

> The transport choice has been superseded by [relay transport v2](2026-10-23-relay-bridge-transport.md); three production readings on 2026-10-23 overturned this note's premises, and the conclusions below stand as a historical record.

## Problem

A paired phone reaches its DSH instance at `https://<id>.dsh-market.com`, and every byte of that origin is served by the market Worker (`market/worker/src/relay.js`): the Worker reads one D1 row holding the instance's current `*.trycloudflare.com` quick-tunnel hostname and forwards the request through the quick tunnel. That makes the market Worker a hop in the data plane, and the quick tunnel the origin transport, while the plugin — the only component that can start, supervise, restart and reap a connector on the user's machine — owns neither of them today.

Two motivations carry this proposal, and neither of them is about tunnel edge placement.

- **The quick tunnel is not a production transport.** It is account-less by design, carries no SLA, and its hostname is minted per start, so the stable origin exists only because a third party proxies it. The live tunnel beside this work is even guarded by a leftover script (`/tmp/netperf-tunnel2.sh`) rather than by any shipped code, which cannot survive a release.
- **A data plane that runs through the Worker couples the phone to the control plane.** Every request and every WebSocket (re)connection costs one D1 read plus one extra forwarding hop, and an outage of D1, of the Worker, or of the tunnel is a phone outage with three independent failure sources. The lease and the registration belong in the control plane; the bytes do not.

Two facts from the 2026-10-23 measurements shape the design without justifying it.

- The relay's latency today is set by the tunnel's edge placement and the return path, not by the market: with the connector on `sjc01` the relay TTFB was about 1.1 s, and only re-homing the connector to `hkg11` (through a locally chosen proxy) brought it to about 0.38 s. The phone reported `colo=HKG` while the product's target users sit in the United States on both ends, and the local proxy choice does not ship.
- The single `530` sample from `tpe01` did **not** reproduce on `hkg11` with the same quick tunnel and the same proxy-built edge connection. The earlier reading "the Worker's return hop is hard-pinned to one edge" is therefore not established and is not used here; at most one sample point failed, which is not a conclusion. If anything, it downgrades to an unexplained residual that a data plane without a Worker subrequest can no longer produce.

## Proposal

Two structural moves, in one decision: the Worker leaves the data path, and the market Worker becomes the relay's control plane only.

On the data plane, each instance gets its own Cloudflare named tunnel, and `<id>.dsh-market.com` becomes an exact proxied CNAME to `<tunnel-uuid>.cfargotunnel.com`. The edge terminates the phone's TLS on the same hostname as today and delivers the request straight to the instance's `cloudflared` connector; no Worker route and no Workers custom domain matches a relay hostname any more, so "the data plane does not pass through the Worker" is a property of the configuration rather than of code paths.

On the control plane, the market Worker keeps the id/secret registry it already has and gains the lease: it creates (or finds) the instance's tunnel, writes the tunnel's ingress and the DNS record, returns a per-instance tunnel token, and reclaims both when the instance is retired. The connector half already ships: [named-tunnel mode](../../implemented/feature/2026-09-02-named-tunnel-mode.md) made the plugin run `cloudflared tunnel run` with a token passed through the environment. What changes is who mints the tunnel and where the fixed hostname comes from, so that [the stable-hostname relay](../../implemented/feature/2026-09-02-stable-hostname-relay.md) stops needing a proxy and keeps its stable origin.

## Context & Efficiency Impact

This note adds one document and no code; the implementation it describes is one D1 migration behind the existing `relay_registrations` table, two control-plane endpoints, and a plugin mode switch that reuses the shipped `RelayRegistrar` backoff and the shipped tunnel manager seams.

- Token footprint of the contract: the claim request carries the id, the secret, the optional `new_secret`, the local origin port and the plugin version; the response carries the mode, the tunnel id, the hostname and the token. Nothing of that shape needs to be cached or stored, so the context cost of reading this note is the decision plus its costs, both in the first three sections.
- Schema overhead: the row keeps the id and secret hash it already stores, and adds the tunnel UUID, the hostname, the origin port, the last registration time and a state column; the legacy target column disappears with the quick-tunnel path.

## Domain and certificate decision

Two constraints bound where the CNAME may land. The wildcard Worker route `*.dsh-market.com/*` captures every `<id>.dsh-market.com` before DNS is consulted, and Universal SSL covers exactly one subdomain level, so any deeper name would need its own certificate work. Both constraints are load-bearing and both are documented.

| Option | Name and certificate | Phone origin | Migration impact | Cost | Condition that overturns it |
| --- | --- | --- | --- | --- | --- |
| A: separate zone for relay hosts | `<id>.dsh-relay.example`; the new zone's Universal SSL covers one level free | Changes | Every paired phone re-pairs once; old and new schemes can coexist, so the cutover needs no adoption gate | A domain registration, a second zone and its certificate lifecycle, and a split brand | Acceptable only if the domain cost or the brand split is unacceptable for another reason |
| B: two-level names under the market zone | `<id>.relay.dsh-market.com`; needs Advanced Certificate Manager to add `*.relay.dsh-market.com` | Changes | Phones re-pair; the route still has to be narrowed anyway, because a wildcard route matches across dots | A paid add-on plus per-level certificate bookkeeping, and the route change is still on the critical path | Viable only if the add-on is already paid for |
| C: narrow the route, single-level names, direct CNAME (chosen) | `<id>.dsh-market.com` on the Universal SSL coverage the zone already has; zero certificate work | Unchanged | Existing phones keep their bookmark and cookie context with no re-pairing; the weakness is that instances still on the old plugin are cut off by one atomic step | One Worker deploy and the deletion of one wildcard custom domain; no new recurring cost | Overturned if the active instance population cannot be migrated inside one announced window, which is what option A buys |
| D: keep the Worker in the data plane | Unchanged | Unchanged | None | Keeps the extra hop, the per-request D1 read and the three-way availability coupling | Overturned only if neither availability nor per-request cost matters |

The evidence behind option C, each from the current official documentation:

- Universal SSL on a full setup covers the zone's root domain and first-level subdomains; deeper names need Total TLS or an advanced certificate ([Universal SSL](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/)).
- Total TLS is not the escape hatch here: it issues certificates for proxied hostnames **except** those used with Cloudflare Tunnel ([Total TLS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/total-tls/)), and the tunnel documentation says a multi-level subdomain needs an explicitly ordered advanced certificate ([Create a remotely-managed tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel-api/)).
- Advanced Certificate Manager is a paid add-on on every plan, wildcard certificates cover one level, and covering several levels means adding one wildcard per level ([Advanced Certificate Manager](https://developers.cloudflare.com/ssl/edge-certificates/advanced-certificate-manager/)).
- A route wildcard matches zero or more of any character rather than one label, so `*.dsh-market.com/*` also matches `a.b.dsh-market.com/*`, and the most specific pattern wins ([Workers routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)). Every option above that keeps this zone therefore has to narrow the route first; option A is the only one that does not.
- An exact DNS record beats a wildcard record, and a `*.dsh-market.com` record already covers several levels ([Wildcard DNS records](https://developers.cloudflare.com/dns/manage-dns-records/reference/wildcard-dns-records/)); the CNAME target must be `<UUID>.cfargotunnel.com` and only proxies records in the same account ([Tunnel DNS records](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/)).

One sub-question is deliberately removed rather than answered. The zone currently carries a dashboard-created `*.dsh-market.com` Workers custom domain, and the documentation describes custom domains as matching the registered hostname exactly and as not supporting wildcard DNS backing ([Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)). Nothing in the documentation promises an ordering between such a wildcard binding and a more specific CNAME, so the chosen plan does not rely on one: it deletes that wildcard custom domain and lets "no route matches, one exact CNAME exists" be the whole explanation. Whether the wildcard binding could be kept to serve an offline page for unknown ids is a named open question in the experiment, not an assumption in the design.

## Control-plane contract

The Worker keeps its endpoints on the market apex (`https://dsh-market.com/api/relay/...`), which is a Workers custom domain and therefore never depends on the relay route.

### Endpoints

| Endpoint | Method | Request | Response | Side effects |
| --- | --- | --- | --- | --- |
| `/api/relay/claim` | `PUT` | `id`, `secret`, optional `new_secret`, `origin.port`, `plugin.version` | `mode` (`named` or `quick`), `tunnel.id`, `tunnel.token`, `hostname`, `dns.target`; a `bridge`-mode lease answers neither `tunnel` nor `dns` | Finds or creates the tunnel named `dsh-relay-<id>`, writes its ingress, finds or creates the CNAME, upserts the row |
| `/api/relay/release` | `POST` | `id`, `secret` | `ok` | Marks the row released; the tunnel and the DNS record survive so a re-enable is instant |
| `/api/relay/retire` | `POST` | `id`, `secret` | `ok` | Deletes the DNS record, then the tunnel, then the row; this is the only path that removes an origin |

The lease runs entirely against the Cloudflare API with a Worker secret: `PUT /accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations` with ingress `[{ "hostname": "<id>.dsh-market.com", "service": "http://127.0.0.1:<port>" }, { "service": "http_status:404" }]`, then `POST /zones/{zone_id}/dns_records` as a proxied CNAME, then `GET /accounts/{account_id}/cfd_tunnel/{tunnel_id}/token` for the token; the ingress lives server-side because a token-run connector is remotely managed, and the catch-all ingress rule is mandatory ([Create a remotely-managed tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel-api/)). The local origin port comes from the claim body, which the plugin already knows from `ctx.webServer.port`.

### Failure, retry and repair

- Authentication and abuse control stay as shipped: the secret is compared as a SHA-256 hash in constant time, the first claim must carry `new_secret` equal to `secret`, and both the per-IP and per-id rate-limit windows ride the same D1 batch as the mutation.
- `400 invalid-params`, `403 auth-failed`, `404 unknown-id` and `429 rate-limited` mean what they mean today; the plugin's existing capped backoff and its one-shot re-claim on `invalid-params` carry over unchanged.
- `502 cf-api-unavailable` is new and carries `retryAfterMs`; the plugin treats it like a network failure, keeps the previous connector running, and retries with backoff.
- Every claim of a tunnel transport reconciles all three pieces — tunnel, ingress, record — by name before answering, so a claim that died halfway converges on the next attempt instead of leaving a half-built instance.
- A `bridge`-mode lease is the exception, and [the transport v2 proposal](2026-10-23-relay-bridge-transport.md) owns it: its data plane is the instance's Durable Object, so its claim reconciles nothing in the account — no tunnel, no ingress, no CNAME, not even a token fetch — and answers the hostname and the bridge grant alone.
- While the quick-tunnel path still ships, a claim failure is not fatal: the response mode stays `quick` and the phone keeps the origin the registry already gives it.

### Teardown and reclaim

- The plugin's teardown (settings toggle off, profile unmount) calls `release`, never `retire`: the hostname is the phone's bookmark, so an origin is removed only when the operator says the instance is gone.
- The cron already running every 30 minutes reclaims rows unseen for 90 days, which is the same TTL the registry uses today; reclamation deletes the record first and the tunnel second, so no window leaves a resolvable hostname pointing at a dead tunnel.
- A `release` followed by a later `claim` is the normal restart path and must stay free: no new tunnel, no new record, one token fetch.

### Token blast radius

- The Worker's Cloudflare API token is scoped to Account: Cloudflare Tunnel, Edit plus Zone: DNS, Edit on `dsh-market.com` only, stored as a Worker secret, and never present in the plugin, the settings document or the process list ([Create a remotely-managed tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel-api/)).
- That token can create and delete every tunnel in the account, so the account's tunnel namespace is dedicated to this relay, and the token rotates on a fixed cadence rather than never.
- The per-instance tunnel token can only run that one tunnel: a leak lets someone else serve that hostname, but it cannot read the instance, reach another instance, or write DNS; the token is returned only to a caller that proved the id's secret and is never logged ([Tunnel permissions](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/remote-tunnel-permissions/)).
- Routine claims never rotate the token, because a refresh stops the old token from establishing new connections; rotation is an explicit repair action, and the plugin already passes the token through `TUNNEL_TOKEN` rather than argv so it never appears in a process listing.

## Migration path

### Cutover order

1. Deploy the control plane additively with the wildcard route untouched, and let every claim answer `mode: "quick"` so no instance moves yet.
2. Ship the plugin release that claims a named tunnel on every tunnel start and runs that connector beside the quick one; the quick connector keeps serving the QR origin, and the named connector is idle because the wildcard route still shadows its DNS record.
3. Gate the cutover on adoption: every id whose row was seen in the last seven days must have claimed a named tunnel and reported at least one edge registration.
4. Narrow the route in one deploy so no pattern matches a relay hostname, and delete the `*.dsh-market.com` Workers custom domain in the same change.
5. After a quiet window, delete the quick-tunnel path: the registrar, `relay_registrations`, the proxy route in `relay.js`, and the `--http-host-header` wiring the proxy needed. This note then partially supersedes [the stable-hostname relay](../../implemented/feature/2026-09-02-stable-hostname-relay.md), which keeps its rationale for the decision it recorded.

### Downtime window

Zero for an instance that adopted in step 2: its hostname never changes, its named connector is already registered, and the route narrowing only removes a shadow, so the phone's next request lands on the connector. The phone's cached address stays valid because the hostname keeps resolving to Cloudflare's edge before and after. The global pause is one Worker deploy plus one custom-domain deletion. An instance that never adopted has no fallback page after step 4 — its hostname stops resolving, and the phone needs a new QR from the desktop — which is exactly why step 4 is gated on step 3.

### Rollback

- Rollback is driven by the control plane, not by a plugin downgrade: `claim` answers `mode`, so flipping it back to `quick` returns every instance to the quick tunnel and the registry on its next start, while that path is still shipped.
- Restoring the route pattern and the wildcard custom domain brings the Worker proxy back, and the registration rows it needs survive the window because `release` never deleted them.
- Both sides have to move together within one window: restoring the route alone leaves migrated instances without a quick target, and the proxy would answer them with its offline page.

## Minimal verification experiment

### Phase 0: read-only controls

These were run before this note was written and need no change to any resource.

| Probe | Command | Reading | What it settles |
| --- | --- | --- | --- |
| A valid-format id with no registration | `curl -s -o /dev/null -w '%{http_code}' https://<16-hex>.dsh-market.com/x` | `503`, body contains the bilingual offline page, `x-robots-tag: noindex`, `cf-ray` in SJC | The wildcard route, not DNS, answers any relay hostname |
| A two-level hostname over TLS | `curl -sv https://x.y.dsh-market.com/` | `sslv3 alert handshake failure`, exit code 000 | Universal SSL covers one level only |
| The same two-level name over DNS | DoH query `name=x.y.dsh-market.com&type=A` | `Status 0` with two edge addresses | The depth limit is the certificate, not DNS |
| The zone's route table | `GET /zones/{zone_id}/workers/routes` | one pattern, `*.dsh-market.com/*` | One row can be the whole data-plane dependency |
| The account's tunnels | `GET /accounts/{account_id}/cfd_tunnel` | empty list | The tunnel namespace is untouched and can be dedicated to the relay |
| What the operator credential can read | `GET /zones/{zone_id}/dns_records` with the local wrangler OAuth token | `10000 Authentication error` | The control plane cannot ride the developer credential; it needs its own scoped token |

### Phase 1: probe tunnel on a non-production zone

One additive account write proves the transport half; it touches no `dsh-market.com` resource and no live hostname.

- Create a tunnel named `dsh-relay-probe` with ingress `http_status:404`, add a proxied CNAME `probe.<other-zone>` pointing at `<uuid>.cfargotunnel.com`, and run the connector with the tunnel token against a local static file server.
- Expected readings: the hostname serves the local file, the response carries no `x-robots-tag` and no Worker-shaped headers, and the connector's log shows `Registered tunnel connection`.
- Expected readings on a second pass with the connector re-homed to a non-SJC edge: the same `200` and a TTFB in the sub-second range, which is the reading the relay could not produce while a Worker subrequest sat in the path.
- Afterwards delete the CNAME and the tunnel; the probe leaves nothing behind.

### Phase 2: post-cutover readings

Run these after step 4 of the migration, with one adopted instance and one phone.

| Check | Command | Expected reading | Meaning if it fails |
| --- | --- | --- | --- |
| No pattern can match a relay host | `GET /zones/{zone_id}/workers/routes` | no `*.dsh-market.com` pattern, and no wildcard Workers custom domain | The narrowing did not take effect |
| Authoritative DNS | DoH `type=CNAME name=<id>.dsh-market.com` | `<uuid>.cfargotunnel.com` | A missing record is an unresolvable hostname |
| The data plane does not rent the Worker | `curl -s -D - https://<id>.dsh-market.com/` | the instance's own `401` body, no `x-robots-tag`, no Worker-stamped `cache-control` on `/assets/` | A Worker still answers the hostname |
| The residual `530` cannot recur | the same request while the connector is registered outside SJC | the instance's own response, not an edge error page | The subrequest was not the whole story |

## Production changes that require approval

1. Create the scoped Cloudflare API token (Account: Cloudflare Tunnel, Edit; Zone: DNS, Edit on `dsh-market.com`) and store it as a Worker secret.
2. Deploy the additive control plane and migrate the `relay_registrations` rows into the lease table.
3. Run the phase-1 probe tunnel on the non-production zone and delete it afterwards.
4. Delete the `*.dsh-market.com` Workers custom domain.
5. Narrow `routes` so no pattern matches a relay hostname, keeping the market apex and the telemetry hostname on their own custom domains.
6. Add the zone Cache Rule that stamps the browser TTL on hashed `/assets/` responses for relay hostnames, which is what the Worker's header stamping does today ([Browser Cache TTL](https://developers.cloudflare.com/cache/how-to/edge-browser-cache-ttl/)).

## Alternatives considered

**A separate zone for relay hosts (option A)** was the strongest competitor and lost on the phone's origin: it buys coexistence between old and new schemes and removes the route question entirely, but it changes every paired phone's origin, and an origin change is a re-pair. Its Universal SSL coverage is free and its CNAME mechanics are identical, so this option stays the documented escalation if the adoption gate in the migration turns out to be unreachable.

**Two-level names with Advanced Certificate Manager (option B)** was rejected because it pays for a certificate add-on and still does not remove the route: a route wildcard matches across dots, so the route still has to be narrowed, and after that narrowing a single-level name on the zone's existing Universal SSL coverage is available for free. Total TLS cannot substitute, because it does not issue certificates for Cloudflare Tunnel hostnames.

**Keeping the Worker in the data plane (option D)** preserves everything that works and costs nothing to decide, but it leaves a per-request D1 read and an extra forwarding hop on the phone's path and keeps three components in the availability chain for a data plane. It is the baseline this proposal is measured against, not a live candidate.

**A plugin-native outbound WebSocket tunnel over Durable Objects** would remove both the quick tunnel and the Worker from the data plane and is still deferred for the reason the relay note recorded: it owns a tunnel protocol — authentication, reconnection, framing, backpressure — and a named tunnel plus DNS gets the same structural property from a maintained connector.

## Acceptance criteria

- A relay hostname resolves to `<uuid>.cfargotunnel.com`, and its responses carry the instance's own headers, never the Worker's offline page or its immutable-asset stamp.
- The zone's route list contains no pattern that can match a relay hostname, and the zone no longer carries a wildcard Workers custom domain.
- A phone paired before the change opens the same bookmark after the change without re-pairing.
- A released instance keeps its hostname, a retired instance loses both the record and the tunnel, and the cron reclaims a 90-day idle row without leaving a resolvable hostname.
- Hashed `/assets/` responses still carry a one-year browser cache on a relay hostname, now from the zone Cache Rule rather than from Worker code.

## Risks

- The atomic step is real: instances that never adopt lose the stable hostname at the route narrowing, and their phones need a new QR from the desktop. The adoption gate and the release note are the only mitigation, and a population that outgrows one window points back to option A.
- The Cloudflare API token can create and delete every tunnel in the account; a leaked Worker secret is account-wide tunnel damage, bounded only by a dedicated tunnel namespace and a rotation cadence.
- Deleting the wildcard Workers custom domain removes the bilingual offline page, so a registered but stopped instance now shows Cloudflare's own tunnel-down error instead.
- One tunnel per profile means the account's tunnel count and the number of connectors on a host grow with adoption, and the adoption window runs two connectors per instance.
- The route narrowing also hands `tv.dsh-market.com` back to its own custom domain: today that hostname is caught by the wildcard route and forwarded to the telemetry-view worker through the service binding that `cloudflare.config.ts` documents, so the telemetry dashboard has to be re-verified on its own binding before the narrowing ships.
- Whether a Worker subrequest to `<uuid>.cfargotunnel.com` succeeds is unverified (to check in phase 1); if it does not, a rollback cannot be one-sided and both sides must move inside one window.
