# Agent Note: The second way to deliver a push, and why the key never ships

Status: implemented

## Problem

Protocol §28 delivers a notification with an Apple provider token signed by an ES256 private key (an Apple `.p8`) that lives on the machine running this bridge. That is the right shape for a developer, and it stops working the moment the iOS App is published: every user would need a key Apple issues to one team, and shipping it with the App turns a signing credential into a public one.

A hosted relay was the obvious answer, but it puts a second party between the bridge and the phone, and the channel has three rules that a careless version of that hop would break: nothing may be awaited on the delta path (§28.5), a notification may carry no session content (§28.4), and a claim held for a phone that cannot be told anything is a claim that keeps an agent waiting for nothing (§11.3).

## Decision

- The channel now stands on one of **two exclusive roads**: `direct`, where this machine's own key signs for APNs, and `relay`, where `account.chatwithai.icu` signs with the one key no deployment holds. `off` is the third state: no key and no relay token, exactly the channel a deployment without a key has always had. The local key always wins; the two roads never run for one event.
- The App obtains a relay token from the account service — scoped to `(userId, fingerprint)`, valid for 90 days — and hands it to the bridge through `push.register` as one optional `relayToken` string. It lands in the `push` block of that device's own roster row, and the roster's on-disk schema moves from 2 to 3 as an additive field. A version-2 file reads back with every field and every paired phone, and is rewritten as version 3 on the next write.
- `src/host/relay.ts` posts one JSON body per event to `POST /v1/push/relay` with `Authorization: Bearer <relayToken>`: `{event, sessionId, title, workspace}` for a notification and `{event: 'live-activity', sessionId, activityId, activityEvent, contentState}` for a card. The contract is frozen between the two repositories; the bridge no longer decides the APNs headers, the bundle, the environment or the alert bodies — the service does, from the registration the App made directly with it.
- The relay answers 200 for every outcome, including a delivery Apple refused: `delivered` counts what landed and `dead` counts the registrations it retired. A delivery that landed on nothing is reported as the failure it is, and `dead` reaches the roster through `PushSendResult.dead` → `isDeadPushToken` → the existing `removePush` and `removeLiveActivityToken` paths. No second cleanup mechanism was added.
- **Reachability is the route's own question.** `DeviceRoster.relayTargets()` reports the rows holding a token, `PushNotifier.enabled` and `LiveActivityNotifier.enabled` read it through an `available` probe, and `BridgeHub.#questionMode()` counts `relayTargets()` on the relay road and `pushTargets()` on the direct one. A relay-mode row without a token is a phone this machine cannot tell anything, so the question is not claimed for it; a bridge with neither road stays as inert as one with no key — no target read, no clock consulted, no timer armed.
- `DSH_REMOTE_BRIDGE_RELAY_URL` moves the relay; it defaults to `https://account.chatwithai.icu`. The mount log states the road it stands on after the roster is read, in one of three lines: `push: direct (APNs key <kid> of team <team>)`, `push: relay (<url>)`, `push: off (no APNs key on this machine and no paired device holds a relay token)`.
- The §28.5 discipline is unchanged on both roads: nothing on the delta path awaits a delivery, the transport resolves `{ok: false, reason}` instead of rejecting, and nothing is retried or queued. A refusal is one log line and a dropped event.
- The payload still carries no session content: the title is the session's own name (or the fixed status line), the workspace is a directory's basename, and the body is the service's fixed phrase — the same strings the direct road sends, because `buildPushNotification` decides them before either road sees them.

## Alternatives considered

- **Ship the `.p8` inside the App, or let each phone hold it.** Rejected: an Apple provider key signs for every notification of a team. In an App bundle it is a public key with Apple's name on it, and a phone holding it can mint tokens for every user of the service.
- **Relay as a fallback after the direct road fails.** Rejected for two reasons. It would send the same event twice on a developer's machine whose key merely expired, and it would make the delivered route depend on APNs' mood at that second — a route an operator cannot read off the log and cannot reproduce. Exclusivity is the property that keeps "where did this event go" answerable.
- **Per-device routing: rows with a token through the relay, rows with only an APNs token through the local key.** Rejected: it doubles the code paths that must agree about payload and dedupe, and it makes one bridge deliver one event two different ways depending on which phone is awake. One bridge, one road.
- **Have the bridge register the device token with the account service itself.** Rejected: the bridge holds no user identity, and the relay token is scoped to exactly that identity. The App already talks to the account service with its session bearer, so the registration belongs there; the bridge only carries the result.
- **A `relay: true` flag on the row instead of reading token presence.** Rejected: a flag can disagree with the credential it describes — true with no token is a row that looks reachable and delivers nothing. The token's presence is the only fact that cannot drift.
- **Queue a notification while the relay is unreachable and send it later.** Rejected by §28.1: a queued "a question is waiting" arrives after the user answered it. Dropping is the honest behaviour.

## Consequences

- Hosted delivery now depends on a service this repository does not run. An outage of the relay means no notification at all on a machine without a local key — there is deliberately no silent local fallback, because a fallback that only works when the operator happens to hold a key is not a fallback.
- `devices.json` holds one more credential: a bearer valid for 90 days, scoped to one pairing's fingerprint, capable of making the service push to that one phone. It grants no session access and no bridge access — a 401 from the relay is the only thing it can earn — but it is a secret of the phone's rather than this repository's, and it is dropped with the row when the device is revoked.
- The offline question claim can now open on the strength of a relay row, which is the point: a suspended phone on a hosted deployment gets the claim window it always got on a machine with a key.
- `PushSendResult` carries an optional `dead` flag so a sender that learned a registration is finished can say so without borrowing an APNs status it never received. Both existing callers read it through the one predicate they already used.
- The package README does not enumerate environment variables, so this note is where `DSH_REMOTE_BRIDGE_RELAY_URL` is documented; the three APNs variables keep their documentation in [the push note](2026-10-21-remote-bridge-push-notifications.md) this one extends.
