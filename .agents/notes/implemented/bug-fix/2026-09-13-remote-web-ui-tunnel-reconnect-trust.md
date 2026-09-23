# Agent Note: The pairing fence keeps its public host across a tunnel reconnect

Status: implemented

## Problem

Issue #1547: with the automatic public tunnel on, every public request answered 403 `{"ok":false,"code":"forbidden"}` while the panel kept showing the QR code and the address it carried. The tunnel phase listener cleared `service.publicBaseUrl` as soon as the tunnel left `running`, and the pairing fence builds its trusted host list from exactly that field, so the host printed in the QR was no longer trusted. `GET /api/pair/status` — an endpoint that exists to be callable before pairing — was rejected with everything else, and the panel showed no reason.

The report's mechanism was correct. It was also incomplete in two ways the diagnosis found: a named tunnel's hostname is fixed by configuration and a registered relay's subdomain is stable, so the relay base was being dropped on every restart for no reason at all.

## Decision

`src/public-base.ts` owns the trusted public base through a small `PublicBaseKeeper`. It publishes `relayUrl ?? tunnelUrl` to `service.setPublicBaseUrl`, and it treats the tunnel phases by mode:

- A **named** tunnel keeps its fixed hostname: a reconnect changes nothing.
- A **relay** registration is stable and is no longer withdrawn when the tunnel restarts; only the relay reporting `off` or teardown clears it.
- A **quick** tunnel does mint a new hostname, so its previous host is kept for a bounded grace window (`PUBLIC_BASE_GRACE_MS`, 60 s) and dropped only if the tunnel has not come back with a new URL by then. The Cloudflare edge can still deliver a connection the phone already opened, and mobile networks reconnect constantly, so an instant drop turned the phone's retry into a silent 403.

A URL reported by a `running` tunnel cancels any pending drop, and `reset`/`dispose` clear the keeper at teardown or when the mode stops owning the base.

## Alternatives considered

Widening the fence to accept `tunnelStatus.url` was rejected: the fence would then trust an address the plugin had already declared dead, and the trusted list would have two sources of truth that can disagree.

Making the panel hide the QR while the tunnel is not running (the issue's second suggestion) was rejected as the primary fix: it does not help a phone whose request is already in flight, and it removes the address the user is looking at while a reconnect usually lands within seconds. The panel already prints the tunnel state next to the QR, so the state is not silent once the request stops failing.

Dropping the host immediately but returning a distinct error code was rejected: the phone cannot act on a code, and the reporter's own experiment shows the address still routes during the window.

## Consequences

The fence now trusts one address for up to 60 s longer than the tunnel that published it. In quick mode that is a real, bounded widening: a Cloudflare quick hostname released and instantly re-registered by someone else would be accepted by the host check during that window, although pairing still requires a one-time token or an already-issued device cookie. Named and relay hosts carry no such risk; for those the change removes a defect rather than adding a window. `tests/public-base.spec.ts` pins the four behaviors (named keeps, relay keeps, quick graces then drops, a new URL cancels).
