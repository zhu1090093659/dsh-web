# Agent Note: Pairing entry pages refused a cross-site navigation (phone showed forbidden)

Status: implemented

## Problem

After a DSH host restart, opening the desktop panel's pairing QR link
(`https://<public-host>/pair-accept?pair=<token>`) on the phone showed a white
page containing only the word `forbidden`. The desktop browser, the same link
in a clean tab, and curl all worked, so the failure was phone-specific.

Root cause: the entry pages fenced with `isTrustedApiRequest()`, which after
the Host check also refuses any request whose `Sec-Fetch-Site` is
`cross-site` or whose `Origin` does not match the request authority. That is
the right fence for `/api` (CSRF defense), but a pairing link is a top-level
document navigation, and the browsers that open QR links most often — WeChat
and other WKWebView wrappers — label exactly that navigation `cross-site`
and/or attach `Origin: null`. The page therefore refused the one request it
exists to serve. The phone's device `lastSeenAt` had not moved since before
the restart, consistent with a refusal before the device check.

## Decision

This amends the marker semantics recorded in [the docker pairing adaptation](2026-09-04-remote-web-ui-docker-pairing-adaptation.md); the dynamic-host bound in [the bounded trusted hosts note](2026-09-05-remote-web-ui-dynamic-trusted-hosts-bound.md) is unchanged.

1. **Split host trust from the browser-marker fence.** `isTrustedHost()` now
   owns the authority check; `isTrustedApiRequest()` keeps the `cross-site`
   and `Origin` rejections on top of it.
2. **Entry pages accept a top-level document navigation.**
   `isTopLevelDocumentNavigation()` (`Sec-Fetch-Mode: navigate` +
   `Sec-Fetch-Dest: document`) lets `/pair-accept`, `/pair-app` and
   `/pair-app.sw.js` pass on a trusted Host regardless of the markers, over
   both the trusted-host and the private-LAN fallback paths. Every other
   request shape — API calls, fetches, iframes, WebSocket upgrades — keeps the
   strict fence, so the CSRF defense is unchanged.
3. **Make the next occurrence diagnosable.** A refusal on an entry page logs
   one line (host, path, reason, the four marker headers), deduped per
   `reason|host|path` and capped at 64 keys, so a real device failure is
   visible in the host console instead of needing a live probe.

## Verification

- Live relay, curl with phone-like headers (`CriOS/152` UA) against
  `/pair-accept`: baseline 200; `Sec-Fetch-Site: cross-site` +
  `navigate`/`document` 403; `Origin: null` 403;
  `Origin: https://weixin.qq.com` 403; foreign `Referer` alone 200. The
  first three are exactly what an in-app browser sends, and the phone's screen
  was the fence's own `text/plain` 403 body.
- Desktop browser end-to-end over the relay: the issued QR link redirects to
  `/pair-app`, the shell boots, the service worker registers and controls
  `/`, and reopening `/` in a new tab still serves the app.
- Package suite: 359 tests pass, including two new specs — a cross-site
  top-level navigation is accepted by `/pair-accept` and `/pair-app` while
  the same markers on a fetch, an iframe and `POST /api/pair/accept` still
  return 403; and the refusal log fires once per shape.
- `pnpm typecheck`, `pnpm test`, `pnpm docs:check`, `pnpm i18n:check`,
  `pnpm aggregate:check` pass. The host half changed, so the fix takes effect
  after a DSH host restart (the running host keeps the old module).

## Alternatives considered

- **Dropping the cross-site/Origin fence everywhere.** Rejected: that is the
  `/api` CSRF defense; the failure is about navigation, not about APIs.
- **Special-casing the WeChat user agent.** Rejected: the marker set is a
  browser-context property, not a product one, and every WKWebView wrapper
  behaves the same.
- **Telling the user to open the link in Safari instead.** Rejected: the QR
  flow must work from whatever scanner opened it; that is the product's job.
- **Accepting the token before the fence.** Rejected: the app page carries no
  token, and the token is exactly what the fence protects against being probed
  from an arbitrary origin.

## Consequences

- Entry pages are reachable from any initiator, which is what a QR link needs;
  the credential (one-time token, or the device id in the URL) stays the
  authority. An iframe still gets 403, so embedding the pages cannot set a
  third-party cookie.
- The relaxation is keyed on the two `Sec-Fetch-*` navigation markers. A
  browser that sends neither keeps the strict fence — and would show the same
  `forbidden` page; the new log line makes that case identifiable at once.
- The refusal log is process-scoped and first-occurrence-only, so it cannot
  flood from repeated probes.
