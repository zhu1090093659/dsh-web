# Agent Note: Relay Control Plane Shipped Additively, Data-Plane Switch Still Pending

Status: implemented

## Problem

[The named-tunnel relay proposal](../../proposed/architecture/2026-10-23-relay-named-tunnel-data-plane.md) decides that the market Worker leaves the relay data plane and becomes its control plane only. Its migration runs in two halves: the control plane and the plugin's second connector land first, then a deployment narrows the wildcard route and removes the custom domain. Shipping the whole thing at once is what the proposal forbids, so the code half must be landed, tested and reviewable while the wildcard route, the Worker proxy branch and the quick-tunnel registry are still exactly as they were — every instance that has not adopted keeps a working origin through a switch nobody has thrown yet.

## Decision

The control plane exists as one additive module, `market/worker/src/relay-control.js`, behind one D1 migration (`0009_relay_leases.sql`) and three endpoints on the market apex. No Worker route, custom domain, cache rule, certificate, tunnel or API token is touched; the quick-tunnel registry (`relay.js`, `/api/relay/register`, `/api/relay/unregister`, the proxy branch, the offline page and the immutable-asset stamp) is unchanged except that its JSON, hash-compare and rate-limit helpers are now exported so both paths share one implementation.

A lease owns three account objects per instance: the remote-managed tunnel `dsh-relay-<id>`, that tunnel's ingress (the instance hostname toward the local origin port, then the catch-all rule remote-managed tunnels require), and an exact proxied CNAME `<id>.dsh-market.com -> <tunnel-id>.cfargotunnel.com`. The lease row points at them and carries the GC clock.

The host-side client in `packages/dsh-remote-bridge/src/host/relay-control.ts` and `relay-connector.ts` (relocated along with the ingress stack; see [2026-10-31-remote-bridge-owns-ingress-stack.md](2026-10-31-remote-bridge-owns-ingress-stack.md)) claims that lease on every quick-tunnel start and runs the named connector beside the quick connector on the same hostname. The `mode` the control plane answers names the connector the phone is meant to be served from; both stay up, so the switch and its rollback are one server-side value with no plugin restart.

## Endpoints and failure grading

| Endpoint | Method | Request | Response | Account effect |
| --- | --- | --- | --- | --- |
| `/api/relay/claim` | `PUT` | `id`, `secret`, optional `new_secret`, `origin.port`, `plugin.version` | `mode`, `tunnel.id`, `tunnel.token`, `hostname`, `dns.target` | find-or-create the tunnel, write ingress, find-or-create the CNAME, read one token, upsert the row |
| `/api/relay/release` | `POST` | `id`, `secret` | `{ ok: true }` | none: the row is marked `released`, the tunnel and the record stay |
| `/api/relay/retire` | `POST` | `id`, `secret` | `{ ok: true }` | delete the record, then the tunnel, then the row |

- Every claim converges the three pieces by name before it answers, so a claim that died halfway is repaired by the next attempt instead of leaving a half-built instance. A second claim on a healthy lease creates nothing and reads one token.
- `400 invalid-params`, `403 auth-failed`, `404 unknown-id` and `429 rate-limited` keep the registry's semantics, including `new_secret` on the first claim and the shared per-IP / per-id windows.
- `cfFailure()` grades upstream Cloudflare failures into two 502 answers carrying `retryAfterMs`: an upstream 429 (`isCfRateLimited()`, matching status code alone) answers `502 cf-api-rate-limited` with 300000 ms (`CF_RATE_LIMIT_RETRY_AFTER_MS`), while other failures answer `502 cf-api-unavailable` with 5000 ms (`CF_RETRY_AFTER_MS`). An isolate-local cooldown gate (`CF_API_COOLDOWN_MS = 60_000`) on `cfCall` stops dialling upstream after a 429 and directly grades calls during cooldown as 429 without sending a fetch (bridge claims bypass `cfCall` and continue to succeed). On the consumer side (`packages/dsh-remote-bridge/src/host/relay-control.ts`), `CLAIM_RETRY_BASE_MS = 5_000` and `CLAIM_RETRY_MAX_MS = 300_000` ensure the Worker's 300-second rate-limit retry hint is not truncated during capped backoff.
- `503 cf-api-unconfigured` is the fail-closed answer of a Worker without its scoped token: nothing is created in the account and no lease row is written.
- The cron GC recovers leases unseen for 90 days in the retire order (record, tunnel, row), bounded by `LEASE_PRUNE_MAX_PER_TICK = 25` rows per tick (`LIMIT ?2`), so no window exists in which the hostname still resolves against a tunnel that is already gone. A row hitting 429 breaks the loop immediately and returns `{ pruned, rateLimited: true }`, leaving that row and subsequent rows with their `tunnel_id` intact for later ticks; row-level non-429 failures proceed to the next row, keeping the failed row's `tunnel_id` for retry. During the `CF_API_COOLDOWN_MS` cooldown, the entire GC tick short-circuits before querying D1 and returns `{ pruned: 0, rateLimited: true }`. A row whose tunnel cannot be removed — no token configured — is left for a configured tick instead of dropped, because the row is the only pointer to that tunnel.

## Deviations from the proposal

1. `503 cf-api-unconfigured` is added beside the proposal's `502 cf-api-unavailable`. The proposal only names the upstream failure; a Worker with no scoped token needs its own code so a caller can tell an outage from a misconfiguration, and so the endpoint can fail closed before writing anything.
2. The claim's rate limit is read before the Cloudflare round trip and spent inside the same batch as the lease upsert. The proposal says the windows ride one D1 batch with the write, which they do; checking first additionally stops a request that is already over budget from spending account calls.
3. `mode` is read from the Worker variable `RELAY_MODE` (absent means `quick`). The proposal fixes the answer, not its source; one variable keeps the flip and the rollback a deployment edit rather than a D1 write.
4. `release` does not move `last_seen_at`. Marking a lease released is the operator saying the instance stopped, not that it was seen, so the 90-day clock keeps running from the last claim and a released instance is still recovered.
5. The idle named connector runs with health probing disabled. While the wildcard route answers the relay hostname, a probe of that URL sees the Worker's offline page and would declare a healthy connector dead on the second round (the failure mode issue #1723 fixed for the quick tunnel), restarting it forever. It also owns a separate crash-recovery record slot (`remote-web-ui-tunnel-child-named.json`) so neither connector's start reaps its sibling's child.
6. Not shipped here, deliberately: route narrowing, the wildcard custom-domain removal, the zone cache rule, and the removal of `relay_registrations` with the proxy branch and its `--http-host-header` wiring. They are the proposal's later migration steps and each of them changes production.

## Alternatives considered

**Delete the tunnel on release.** It makes release and retire the same operation with different names, and it costs the property the proposal buys: a re-enabled instance would go through find-or-create again instead of one token read. Keeping the tunnel is what makes "re-enabling is instant" true.

**Make the lease a precondition of the quick tunnel.** The endpoints exist so instances can migrate, not so a control-plane outage blinds every unmigrated phone. The claim stays best-effort and the quick path never waits on it.

**One tunnel manager for both connectors.** The two connectors want opposite supervision: the quick one must be declared dead when its public URL stops answering, the idle one must not be probed at all, and each needs its own orphan record so a crash reaps exactly the child it left. Two managers over one shared spawn path is smaller than one manager with two policies.

**Reuse `relay_registrations` as the lease table.** The target, TTL and state columns differ, and a shared row would make the quick path depend on the control plane before the switch. A separate table lets the registry be deleted wholesale in the proposal's last step.

## Consequences

- The account has no relay resources until someone claims, and nothing claims until the endpoints are deployed with the token configured. The code half is inert in production until then.
- A lease row can outlive a tunnel that D1 never recorded (a Cloudflare call succeeded, then the write failed). The next claim converges it by name; a lease that is never re-claimed again is recoverable only by the operator, because no row points at it.
- The plugin now runs two cloudflared children per instance, which the proposal's risk section already costs out.
- With `mode: quick` every instance behaves exactly as before: same origin, same proxy path, same offline page.

No production write was performed for this change: no deployment, no tunnel, no DNS record, no Worker route, no certificate and no API token. Every behaviour above is pinned by tests that inject the Cloudflare client and D1.

## Testing

- `node --test scripts/market-relay-control.test.mjs` — 32 offline tests: find-or-create convergence (a second claim creates neither tunnel nor record), ingress shape with the catch-all rule, drifted-CNAME repair, shared auth and rate-limit semantics, fail-closed without a token, 502 grading into `cf-api-rate-limited` (300 s) and `cf-api-unavailable` (5 s) with `retryAfterMs`, cron GC row limit (`LEASE_PRUNE_MAX_PER_TICK = 25`), 429 immediately breaking the GC tick, isolate-local cooldown gate (`CF_API_COOLDOWN_MS = 60_000`) with recovery after expiry and `resetCfApiCooldown()`, 5xx not arming the cooldown, authentication not short-circuited during cooldown, bridge mode claiming without account calls, release keeping tunnel and record, and retire/cron GC deleting record before tunnel before row.
- `packages/dsh-remote-bridge/tests/relay-control.spec.ts` — 15 tests: claim request body, lease read-back, refusal grading (403 terminal, 400 re-claims the id, retry hint raising backoff floor), 300-second rate-limit retry hint not truncated by `CLAIM_RETRY_MAX_MS = 300_000`, exponential backoff cap converging at 300 s, bridge mode claim without cloudflare resources, and release calling the release endpoint rather than retire.
- `node --test scripts/market-relay.test.mjs` — the untouched registry and proxy path still pass.
