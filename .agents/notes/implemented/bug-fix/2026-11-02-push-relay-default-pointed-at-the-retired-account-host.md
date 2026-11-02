# Agent Note: The relay's default address is the account service the App signs into

Status: implemented

## Problem

`RELAY_DEFAULT_URL` named `https://account.dsh-market.com` — the Cloudflare Worker that used to serve the account service. The App now mints its relay token at `https://account.chatwithai.icu`, the self-hosted service, so a bridge standing on the relay road carried a token to a deployment that never issued it and every delivery was refused. Measured on 2026-11-02 against `dsh-web` on local1:

- 72 h of journal: **37 × `401 unauthorized`**, 5 × `relay request failed: TypeError: fetch failed`, **0 delivered**.
- The same stored token, two deployments: `POST https://account.chatwithai.icu/v1/push/relay` → `400 invalid_request` (bearer accepted, body refused), `POST https://account.dsh-market.com/v1/push/relay` → `401 unauthorized`.
- The one machine that did notify held its own APNs key and stood on `direct`, which is why the defect was invisible from there: the mount log said `push: direct`, and a direct road never reads this constant.

## Decision

`RELAY_DEFAULT_URL` is `https://account.chatwithai.icu`, and `tests/relay.spec.ts` pins that address instead of the retired one. `DSH_REMOTE_BRIDGE_RELAY_URL` still moves the relay, and nothing else about the road changes: the [push relay note](../architecture/2026-10-30-remote-bridge-push-relay.md) keeps its decision and only its address fact moves.

## Alternatives considered

- **Leave the default and require the variable on every host**: rejected. A missing variable then looks exactly like a working one — the bridge mounts `push: relay (https://account.dsh-market.com)`, answers `ok` to `push.register`, and every delivery dies as a single log line nobody reads, which is the 72 h above.
- **Try the deployments in order**: rejected. The road is exclusive on purpose (nothing is awaited on the delta path, and "where did this event go" has to be readable off one log line); a fallback would turn one deployment's outage into the other's success.
- **Make the constant the deployment's own host name**: rejected. The relay exists so any bridge can reach the one service that signs for everyone; a bridge with its own deployment sets the variable.

## Consequences

- A bridge with no APNs key of its own posts to the deployment that minted the token, and the 401 stops at the auth step. What the service does with an accepted delivery is the service's business: with a valid token and a fresh session id it answered `{ok:true, delivered:0, dead:0}` on 2026-11-02, i.e. accepted and not delivered — a fact of the account service, not of this default.
- The retired address still resolves and still answers `401`, so a deployment pinned to it by the variable keeps failing loudly instead of silently switching service.
- `lib/` is not committed for this package: a host that runs the built output needs a rebuild to inherit the constant, while a host that sets the variable needs nothing. local1 is the second case today: the build of this package still fails typecheck on the SDK AskUserQuestion union recorded in the repository instructions, so the running host sets DSH_REMOTE_BRIDGE_RELAY_URL in dsh-web.service until that is repaired.
