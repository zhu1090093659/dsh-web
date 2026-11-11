# Agent Note: Task board bridges the Host connection authentication

Status: implemented

## Problem

A dsh deployment served through a reverse proxy, Kubernetes ingress, or Tailscale reaches the GUI with a trusted host authority: the operator starts `dsh web --host <lan-ip> --trusted-host dsh.example.internal`, TLS terminates at the edge, and the Host's `connection` service authenticates every `/api` request with its Host/Origin fence and the authority-bound, HMAC-signed `dsh-auth-*` browser session. The rest of the GUI works. The task board did not: `GET /api/task-board/state` answered 403, because `isTrustedTaskBoardRequest` fenced every route on `isLoopbackAddress(req.socket.remoteAddress)` and the proxy or ingress presents a gateway or container address, never `127.0.0.1`.

The board already had two reverse-proxy paths, and neither fits this deployment. `trustedProxyHosts` requires the operator's proxy to inject a board-specific server token that a managed ingress has nowhere to set, and `trustForwardedProxy` (#1918) admits only the forwarded request that landed on this machine's loopback upstream, together with a default-off switch. A deployment whose Host already authenticates the browser with its own signed session was still asked to configure a second, weaker trust path for one plugin.

This is the issue [#1930](https://github.com/zhu1090093659/dsh-web/issues/1930) report. It sits beside the reverse-proxy classification decision in [A forwarding header makes a reverse-proxied request remote](2026-10-19-reverse-proxy-loopback-fence.md), which owns the shared loopback fence and the board's forwarded-proxy switch; that fence stays exactly as it shipped.

## Decision

- The board resolves the composition's optional `connection` service at request time through `resolveConnectionTrust` (`packages/dsh-task-board/src/index.ts`) and hands a reader to the route access (`connection?: () => TaskBoardConnectionTrust | undefined`). It is resolved like the optional agent-tool registry instead of being added to `inject`: a composition that serves no connection must still mount the whole board.
- At the top of `isTrustedTaskBoardRequest` (`packages/dsh-task-board/src/host-routes.ts`), a mounted connection service that answers `undefined` from `requestRejection(req)` admits the request outright. That verdict already covers what the board would otherwise need: the Host fence (loopback, the listener's bind literal, or the configured `trustedHosts`), the Origin-equality check, the refusal of an explicit `sec-fetch-site: cross-site` marker, and verification of the signed browser session against the secret the Host persists. The board does not repeat any of it.
- The pre-existing fence remains the fallback, unchanged and in its old order: the browser same-origin marker, `isLoopbackRequest`, the loopback socket plus allowlisted Host plus server token path, and the default-off forwarded-proxy path. The service declining a request, being absent, or mounting after the routes is therefore never a new refusal: a direct loopback client the service does not authenticate keeps reaching the board exactly as before.
- The service face is declared structurally as `TaskBoardConnectionTrust`, the same shape the official open-in-app routes consume, so the Host half never value-imports the browser-side connection package. The board keeps its single refusal status (403) even when the service would answer 401; the difference does not change whether a request reaches the board, and the browser half already maps a fence refusal to its one authentication message.
- No configuration key is added. The bridge is on whenever the Host serves the service, because the operator's trust decision is the one already made by `--trusted-host`/`trustedHosts` and the browser session is minted by the same Host. A third-party proxy outside that configuration still fails the service's own fence and falls back to the board's.

## Alternatives considered

Adding `connection` to the plugin's required `inject` was rejected: the board is mounted by compositions that serve no connection service, and a required injection would turn a working board into an unmounted one there.

Replacing the board's fence with the connection verdict was rejected: direct loopback access, the authenticated-token proxy path, the forwarded-proxy path, and every test or embedding that mounts the routes without a Host context must keep their exact behavior, and the bridge has to be an additional admission path rather than a new authority.

Propagating the service's 401 was rejected as surface with no access consequence: every route family in this repository answers one refusal status, and the browser panel turns that refusal into the same authentication message. Splitting 401 from 403 would make the board's response depend on which of two fences denied the request without telling the caller anything it can act on.

Trusting the bare presence of a `dsh-auth-*` cookie (the existing browser marker) was rejected: the marker is a signal that a browser-shaped client exists, not proof that the Host signed the session. Verifying the signature and authority is exactly what the connection service contributes, which is why the board asks it instead of reading the header itself.

Requiring the operator to add the board to another allowlist or inject another token was rejected: the ingress already established the identity, and duplicating it here is the configuration burden the issue reports.

## Consequences

- A deployment behind a reverse proxy, ingress, or trusted tunnel that DSH already serves reaches every board route (state, action, events, parse, model-catalog, attachments) with no board-specific configuration; the guard is shared by all of them.
- A caller the Host's connection service does not authenticate gains nothing: the service refuses it, and the board's fallback still refuses a non-loopback proxy authority unless the explicit token or forwarded-proxy opt-in applies. Cross-site posts are refused by the service before the board sees them.
- A composition without the connection service, and every direct loopback client the service declines, keep the pre-existing decisions; the bridge never subtracts an admission the board used to grant.
- The forwarded-proxy switch and the token allowlist keep their documented meanings and remain the paths for proxies the Host does not authenticate itself.

## Testing

- `packages/dsh-task-board/tests/connection-auth-bridge.spec.ts` (7 tests) runs the real route family over a loopback listener with the socket peer overridden to a gateway address. It pins: an accepted connection session admits state and an action (200, action applied once); a declined session refuses the action (403, nothing applied); no service keeps the loopback-only fence; a direct loopback session stays admitted when the service declines it; a service mounted after the routes is picked up on the next request; and the resolver returns the mounted service only when it really exposes `requestRejection`, answering undefined for a missing, incomplete, or throwing lookup.
- `pnpm --filter @linxin666/dsh-client-ui-task-board typecheck`, its `vitest run` suite (1243 passed and 1 skipped with bounded workers; the default worker count on a loaded local machine intermittently hits the 5 s timeout in unrelated ledger and fiber tests, each of which passes alone), and `pnpm test:standards` are the local evidence; `pnpm docs:check` covers the paired README edits and `pnpm i18n:check` stays green.
