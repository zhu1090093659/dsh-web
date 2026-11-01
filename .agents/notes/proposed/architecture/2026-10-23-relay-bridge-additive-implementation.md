# Agent Note: the Relay Bridge, Implemented Additively - per-instance mode, a long-lived credential, socket replacement on the object

Status: proposed (implemented and tested, not deployed)

This is the implementation record of the [relay transport v2 proposal](2026-10-23-relay-bridge-transport.md). The mechanism that note chose is now code that can be merged; the design and its readings remain authoritative, and this note records only the decisions the landing settled, the deviations, and the evidence.

## Where it landed

| Location | What it holds |
| --- | --- |
| `market/worker/migrations/0010_relay_lease_mode.sql` | `relay_leases.mode`, default `quick`; flipping one instance is one UPDATE |
| `market/worker/src/relay-bridge.js` | `RelayBridge` (the object) and the `/api/relay/bridge` door (credential, windows, attach marker) |
| `market/worker/src/relay.js` | `bridgeModeOf` and the data-plane split; the quick branch gains two lines at its end |
| `market/worker/src/relay-control.js` | the claim reply carries that instance's `mode` and the bridge endpoint; a bridged claim converges no tunnel, ingress or CNAME and sends no Cloudflare call |
| `market/worker/cloudflare.config.ts` | the `RELAY_BRIDGE` namespace and the `RelayBridge` class ledger |
| `packages/dsh-remote-web-ui/src/relay-bridge-connector.ts` | the plugin connector, grown from `probe/relay-bridge/connector.mjs`, beside the quick connector |
| `packages/dsh-remote-web-ui/src/relay-connector.ts` | starts the bridge after a claim, stops it on release and teardown |
| `scripts/market-relay-bridge.test.mjs`, `packages/dsh-remote-web-ui/tests/relay-bridge-connector.spec.ts` | the tests of the new behavior |

## Three implementation decisions

1. **The bridge credential is the lease's own id and secret.** The design demanded a long-lived credential, not a newly minted one: the id/secret pair is the only long-lived thing an instance holds, the Worker stores it as a SHA-256 hash, compares it in constant time, and rate-limits it on the registry's buckets. It travels in the upgrade's `authorization: Bearer <secret>` header, never in a URL, and the claim reply names the credential shape (`credential: 'lease-secret'`) instead of echoing it -- a second copy of a secret in a response body buys nothing and is one more leak surface. Overturned if the lease secret ever has to rotate or be revoked independently of the quick path.
2. **The newest attach wins when one credential dials twice at once.** The object replaces the socket it held (the old connection is closed `1000 replaced`), the streams multiplexed on that socket fail at once -- the connector that owned them no longer holds the connection, so waiting only spends the 60-second head timeout -- and streams the new socket already started are untouched. That is what makes "a release means every socket reconnects" safe on the object side: the connector reconnects with the same credential, with no ticket to spend and no new instance to move to.
3. **The mode is read on its own, and an unreadable mode is `quick`.** The design said "one more column"; the implementation spends one more D1 read per relay request, and buys deploy-order safety with it: a Worker shipped before migration 0010 makes `SELECT mode` fail on that request only, leaving the instance on quick instead of answering the whole relay fleet with 503.

## Deviations from the design

- The design puts `mode` on `relay_registrations`; this round puts it on the lease table `relay_leases`, the row claim writes. The cost is the extra read of decision 3.
- The design's observation surface includes sampling `getWebSockets().length` every 60 seconds. Sampling needs an alarm, which is its own lifecycle and billing decision; this round ships `x-relay-transport`, `x-relay-fallback` and the structured logs (`bridge-attach`, `bridge-done`, `bridge-failed`) only.
- The design's "forwarded `cf-ray`" is not implemented: repeating the edge's own `cf-ray` on the response has no benefit.
- The design says "the Worker hands the whole Request to the object". The object instead puts the public origin into the `req` frame's `host` field rather than trusting a `Host` header through the object: in Workers the header is not a trustworthy source, and what the connector must receive is the origin the phone dialed, never the loopback authority it dials itself.
- The claim reply never echoes the secret (decision 1).

## What the tests pin

- A quick instance still rides `*.trycloudflare.com` and never touches an object (the existing suites stay green, and the proxy branch gains two lines).
- A bridge instance is served by that instance's object, carries `x-relay-transport: bridge`, and never dials the quick tunnel.
- With no socket the object answers `409 no-connector`, the Worker falls back to quick inside the same request, and the response carries `x-relay-fallback: no-connector`.
- A bridged claim sends no Cloudflare call at all and answers no `tunnel` block, while a quick claim keeps its exact tunnel-plus-CNAME convergence order.
- A lease table that cannot answer the mode keeps the instance on quick instead of answering 503.
- A downstream request cannot present itself as a connector attach (the marker header is stripped on the proxy path).
- The door: a plain request is 426, an unknown id and a wrong secret answer 403 alike, a spent window answers 429, and only then is the object named by id.
- The object writes the public origin into the `req` frame; no literal `127.0.0.1` appears in it.
- A second attach replaces the first: the old socket is closed `1000 replaced` and requests travel on the new one only.
- Connector side: it forwards the public origin as `Host` (so the local control plane answers 403, while the same upstream asked with a loopback Host answers 200 -- that difference is the whole reason the connector may not rewrite the header); with no `host` it falls back to the instance's own relay hostname; a reconnect presents the same credential twice; a phone WebSocket round-trips through it.

## Readings

Local (`wrangler dev --local` running the real Worker and the real object, the plugin's own connector, the local DSH host as upstream, `mode=bridge`): `/remote-bridge/pair/token` answered `403` (`the request names a Host that is not this machine`, `x-relay-transport: bridge`), `/` answered `401`, the WebSocket dial took 14.9 ms, hello 5.0 ms (`auth: unpaired`), and later requests had a 0.8 ms median round trip.

Edge (`dsh-relay-bridge-staging.1090093659.workers.dev`, deleted right after): an upgrade with a wrong secret answered `403`, an upgrade with the right credential got `101` and put the connector in connected. The data plane cannot be exercised on `workers.dev`: `relayIdOf` only accepts `<id>.dsh-market.com`, and a mismatched `Host` sent to a `workers.dev` hostname is refused by the edge with `403`.

## What is still missing before production

- Flipping `mode` per instance (1% first, then batches by `last_seen_at`), one UPDATE per batch.
- A real-edge reading of the data plane on a relay hostname: that needs a non-production flight on a custom domain, or shipping the first instance straight into a batch.
- The measured per-object socket ceiling and per-request wake time (what stage 3 still owes).
