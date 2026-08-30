# Agent Note: Route the gateway stream mux through the gated remote channel

Status: implemented

## Problem

After the official-UI adaptation round, a paired phone landing on `/pair-app` did not mirror the PC's running DSH: the app asked the user to re-select a workspace and reported no sessions — exactly the shape of a fresh instance, not a mirror. Everything host-side (workspace registry, session store) is public to any browser on the same host, so the data was there; the phone's client was not receiving it.

## Decision

**The gated channel now covers the official stream socket.** On the pinned 0.1.2-alpha.1 line the client opens exactly ONE persistent WebSocket — the Typert gateway mux at `/api/remote.mux` — and every Remote stream (workspace follow, session feed, subagent lineage, ...) rides that socket. The channel's rewrite tables had stale legacy paths (`/api/events.mux`, `/api/events.host` — neither exists in this cohort), so the phone's mux was never rewritten to `/remote/api/remote.mux`; it connected straight to the tunnel origin, where the connection fence plus the browser-auth cookie reject the upgrade (the cookieless phone carries neither), and all streams died. The fix:

- `wsPaths` now lists `/api/remote.mux` (plus the sidebar/ssh terminals); both the parse-time boot patch and the runtime patch consume the same rules.
- The host registers the exact upgrade route `/remote/api/remote.mux`, mapping back to the inner `/api/remote.mux`, preserving the `device` query the cookieless credential rides on.
- The stale `events.*` constants are gone; the contract-pin tests assert the mux path.

The mobile surface keeps the desktop-only suppressors unchanged: the pet, ssh, skill-explorer, task-board, git-graph, perf and usage surfaces stay hidden on the portrait-touch phone mirror — the phone mirror is deliberately desktop-decoration-free.

## Alternatives considered

- **Proxy every WS upgrade under `/api` instead of listing exact paths.** Rejected: the webserver dispatches upgrades by exact path and the connection plugin owns the `/api/remote.mux` path; a generic prefix proxy would race the gateway's own upgrade route. Exact mirrors keep one route per socket and keep the device gate in front of each.
- **Show the pet on the mobile mirror (drop it from the portrait suppressor list).** Considered during the same round and rejected by the user: the floating pet covers the small viewport and the phone mirror is by design free of the desktop decoration, so the suppression is the requirement, not a regression to undo.

## Consequences

- The phone client's workspace/session feeds arrive over the gated channel; the mirror shows the same workspaces and sessions as the PC.
- The boot script is bigger by one path entry; loopback origins are untouched.
- The channel's coverage is now cohort-exact: any future SDK stream-socket change must update `wsPaths` and `REMOTE_UPGRADE_PATHS` together (both derive from the same rules tables) — the contract-pin tests fail on drift.

## Testing

- Unit: mux path rewrite rules (runtime patch + boot script), the exact upgrade route mapping `/remote/api/remote.mux` → inner `/api/remote.mux` while preserving `?device=`, and the mobile-adapt stylesheet still suppressing the pet together with the other desktop-oriented surfaces. Package suite: 283 tests / 26 files green.
- Live (QA instance on :3191, DSH_HOME=/Users/zcl/dsh-qa-home): fresh browser context with iPhone emulation paired over the LAN origin, landing on `/pair-app`; the workspace list and sessions loaded (the sidebar matched the desktop tab row-for-row), and the pet surface stayed suppressed in the portrait layer. A reload of the bare `/` on a cookie-blocked browser still hits the harness index gate — re-scanning the pair link re-enters; documented as a known boundary, not a regression.
