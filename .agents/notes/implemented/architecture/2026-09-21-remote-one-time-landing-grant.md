# Agent Note: the remote app landing carries a one-time grant, and host mode is server-granted

Status: implemented

## Problem

Two credentials on the paired-device path were weaker than the reference
implementation's treatment of the same flow.

The `/pair-accept` → `/pair-app` redirect carried the freshly minted **device
id** in its query (`/pair-app?device=<id>`). A device id is a live session
credential: `pairedDeviceIdOf` authorizes every gated `/remote` request by it,
and the cookie it mirrors lives a year. Putting it in a URL publishes it into
browser history, the address bar, and every log on the redirect path — the
exact value the channel gate trusts.

Host mode was asserted from the origin. The parse-time boot patch installed
`__DSH_TRANSPORT__ = { ownsHost: true }` on every non-loopback origin, so any
shell that reached a browser on a non-loopback authority presented the official
UI's full configuration surface. The pairing gate still refused the calls, but
the privileged presentation was a client-side claim rather than a server-issued
grant — and on a deployment whose `/api` fence is open (the posture the probe
reports) the shell is reachable without pairing at all.

## Decision

- **The landing URL carries a one-time grant.** `src/pair-grant.ts` ports the
  reference implementation's one-time capability semantics (zcode
  `packages/server/src/hostCapability.ts`): 256 bits of base64url entropy, a
  60 s TTL, a bounded table (`MAX_LIVE_GRANTS = 256`, oldest evicted first), and
  delete-on-attempt consumption — the record is removed before it is validated,
  so a replay never resolves and an expired grant does not linger. `/pair-accept`
  mints a grant bound to the new device session and redirects to
  `/pair-app?grant=<g>`; the landing spends it and hands the device id to the
  shell in its own response (the capture script it patches in). `?device=` on
  the landing is retired; the WebSocket `device` query (`REMOTE_DEVICE_QUERY`) is
  a different transport and stays.
- **Host mode is server-granted.** The capture script the device-gated landing
  patches in publishes `__DSH_REMOTE_HOST_GRANT__`, and the boot patch installs
  the transport hook only when that marker is already set. `patchAppShell`
  therefore inserts the capture script immediately after the opening `<head>`
  tag — ahead of the harness-injected boot patch — instead of before `</head>`.
  A shell served to an unpaired browser never carries the marker, so it keeps
  the official UI's memory-scope presentation.
- **The pairing cookie is `Secure` over TLS.** `deviceCookie` adds `Secure`
  when the request arrived over TLS (`x-forwarded-proto: https`, the same signal
  `appOrigin` already trusts) and leaves it off on plain-HTTP LAN, where a
  Secure cookie is dropped by the browser and the phone would silently lose its
  session.

## Testing

- `tests/pair-grant.spec.ts` (8 tests) pins the one-time semantics over an
  injected clock: single spend, replay refusal, the TTL boundary, unknown/empty
  grants, non-spending `peek`, purge on issue, the FIFO cap, and the default
  entropy shape.
- `tests/routes.spec.ts` covers the redirect, the single-use landing (a replayed
  grant gets the re-scan page), the retired `?device=` query, the
  capture-script/boot-patch ordering, and the Secure/no-Secure cookie pair.
- `tests/docker-pairing.spec.ts` and `tests/remote-channel-boot.spec.ts` follow
  the new contract; the boot patch gains an explicit negative case (no marker,
  no `ownsHost`).

## Alternatives considered

- Keeping `?device=` and adding the grant alongside it: rejected — accepting the
  device id in a URL keeps the leak alive, and the capture script already hands
  the shell the device id, so nothing needs the query.
- Making the grant survive a page reload (a session-scoped credential): rejected
  — that is the device cookie's job; the grant exists only to keep the
  credential out of the URL, and a reopen is served by the cookie through the
  service worker's network-first navigation.
- Using a one-time capability for the WebSocket upgrades too: rejected — a WS
  URL is reused on every reconnect and the client cannot mint a fresh grant
  synchronously inside the `WebSocket` constructor; the device cookie/query
  stays the transport credential there.
- Deciding host mode from a fresh server round trip at boot: rejected — the boot
  patch must decide synchronously before the connection plugin reads
  `__DSH_TRANSPORT__`, and the landing's own response is already the server's
  grant.

## Consequences

- A leaked landing URL is worth one redemption inside 60 s and nothing after,
  and the session credential no longer appears in any URL on the pairing path.
- The `/pair-app` contract changed: a phone mid-flow across an upgrade, or a
  bookmarked landing URL, must re-scan. The landing immediately replaces its own
  URL through `history.replaceState`, so no user-visible bookmark depends on it.
- Host mode now requires the landing's response. The supported entries — first
  scan, service-worker reopen, tunneled reopen — all go through `/pair-app`; a
  paired device that loads the harness shell by some other route keeps the
  memory-scope presentation until it re-enters through the landing.
- The `device` query remains on WebSocket upgrades and is still a URL-borne
  credential there; that transport cannot carry headers from the Web API, and
  the pairing cookie stays the primary credential wherever the browser stores
  cookies.
