# Agent Note: Issue batch 1646-1665 — the unconditional channel gate, the sidebar agent-opens socket, and the issue-label race

Status: implemented

## Problem

Four open reports and one closed duplicate exposed three defects and two dispositions:

1. **#1665 — a paired device could disarm the `/remote` gate.** `packages/dsh-remote-web-ui/src/remote-api.ts` skipped its paired-cookie check entirely when `requirePairingForLan` was false. That policy value is a settings key, and the family settings bridge (`/api/dsh-web-ui-settings`) is deliberately re-exposed to paired devices for settings parity — so a paired device could set it to false and the channel then admitted every caller that could reach the port. The channel is not a neutral relay: it re-issues every forwarded call with the process's own harness browser-auth credential (`inner-auth.ts`), so an unpaired caller admitted there drove the full host API — chat, sessions, tools — while the desktop panel still showed "stopped / 0 devices" and `stop()` left the policy untouched.
2. **#1646 — the sidebar's model-opened push socket never rode the channel.** `wsPaths` and `REMOTE_UPGRADE_PATHS` listed `/sidebar/ws/terminal` and `/sidebar/ws/agent-terminals` but not `/sidebar/ws/agent-opens`. On a paired remote the browser connected the unrewritten path to the tunnel origin, the upgrade was refused, `dsh-better-sidebar` gave up after five retries, and `sidebar_open` never reached the device (`delivered:false`, replayed only on the next attach).
3. **The issue-template enforcer closed every non-collaborator bug report.** `issue-template-enforcer.yml` required the `bug` label, which `auto-label-issues.yml` applies on its own `issues: opened` event. Both workflows run on `opened`, so they race, and the enforcer read a snapshot taken before the label existed. GitHub attaches the label atomically only for form submissions, so a report filed through the API or CLI (the contributor workflow) was closed as `not_planned` before any human read it — #1646 and #1648, one reporter, twice.

## Decision

**The `/remote` channel gate is unconditional and is not an authorization input from settings.** `requirePairingForLan` is removed from `RemoteApiDeps` entirely rather than defaulted to true, so no future call site can re-introduce the bypass by passing a value: both the HTTP handler and the upgrade handler always require a live paired credential (cookie, cookieless header, or the `device` query on a handshake). The LAN policy keeps exactly two meanings — whether the desktop half installs the client-side rewrite, and the plain `/api` surface's own posture — and can no longer widen the channel. `stop()` therefore needs no change: it already empties the device table, so the next request 403s (pinned by a test). The settings bridge stays re-exposed to paired devices, per [remote control reuses the official UI](../../architecture/2026-08-29-remote-control-reuses-official-ui.md); what changed is that a write through it can no longer disarm the gate.

**The sidebar family is covered as a set, with a drift guard instead of a hand-maintained list.** `/sidebar/ws/agent-opens` joins both `wsPaths` (consumed by the parse-time boot patch and the runtime patch) and `REMOTE_UPGRADE_PATHS` (the host's exact-path upgrade registration). Because a path in the first without the second is rewritten to a dead route — the exact failure #1646 reported — `tests/remote-contract.spec.ts` now derives the expected upgrade set from `wsPaths` and asserts equality, so the next missing socket fails the suite instead of shipping.

**The issue-template enforcer decides bug-ness from the issue body alone.** Label membership is no longer read at all: the `Issue 类型` section is the signal, matched case-insensitively against the bug value the form emits. The form's atomic `labels: ["bug"]` still applies on form submissions, and `auto-label-issues.yml` is left alone to label API-filed reports on its own event; the two workflows are now independent rather than ordered.

The two remaining reports were dispositions, not code changes:

- **#1642 (stale shell revision after a `dsh web` restart)** — the failing object is the loader entry's combination URL and its process nonce, owned by the official `@deepseek-ai/dsh-client-modules`. This repository's existing defences (`no-store` on `/pair-app` and the app shell, the network-first reopen service worker, the 15 s boot watchdog) cover the navigation and document layer only, which is why clearing site data recovers. Tracked upstream; the repo-side hardening options (a liveness probe before serving a cached shell, and a watchdog that lands on the re-pair page instead of a bare reload) are recorded on the issue as follow-ups rather than implemented here.
- **#1654 (task-board mainline/branch attention lanes)** — a feature proposal from a contributor offering to implement it. Direction acknowledged and left open to an M0 PR from the author; not built here, so it does not enter this batch's decision.

## Alternatives considered

- **#1665: add the settings bridge to `LOCAL_ONLY_PREFIXES`.** The issue's first suggestion, and rejected: settings parity for a paired device is a recorded decision (the bridge was re-exposed on purpose), and the whole configuration plane — not just this one key — rides the channel. Blacklisting one path would leave the same class of defect for the next policy key that gates something.
- **#1665: make the policy field writable only from a physically local caller.** Rejected as the primary fix: it hard-codes a per-key exception inside a generic settings seam the plugin does not own, and it would silently break the desktop's own settings card if the channel later carried it. Fixing the gate removes the entire class instead of one instance.
- **#1665: still require a device credential when the policy is off, but keep the parameter.** Rejected as weaker than deleting it: a retained-but-ignored parameter invites a reader (or a new call site) to believe it authorizes something. Removing it makes the wrong thing unrepresentable.
- **#1665: make `stop()` reset the policy to true.** The issue's fourth suggestion. Rejected as an incomplete defence: it leaves the window between the write and the stop, and it makes revocation depend on an unrelated settings write. The unconditional gate closes the chain at the point of use.
- **#1646: proxy all `/sidebar/ws/*` upgrades generically.** Rejected for the same reason the gateway mux note rejected a generic `/api` upgrade proxy: the webserver dispatches upgrades by exact path, so a prefix proxy would race whichever plugin owns the socket, and each socket would lose its own device gate. The drift-guard test addresses the maintenance cost instead.
- **#1646: fix `dsh-better-sidebar` to use a relative path.** Rejected: the socket is same-origin by construction, and the omission is in this plugin's rewrite table, not the caller's URL building.
- **Enforcer: allow-list the known bot-shortcut, e.g. treat a missing label as "unknown" and re-check on the next event.** Rejected: the workflow would still need a second event to converge, and `auto-label-issues.yml` already fires on `edited`; deciding from the body converges on the first run.
- **Enforcer: trigger on `labeled` as well as `opened`.** Rejected: it closes the same report on a later event instead of not closing it at all, and it doubles the workflow runs for every issue.

## Consequences

- An unpaired caller can no longer reach any part of the host API through `/remote`, whatever the settings file says. The reported chain (pair → write the policy off → drop the cookie) now fails at the first unpaired request with `403 unpaired`.
- `requirePairingForLan` remains a real, user-visible policy for the plain `/api` surface; the desktop settings card hint describes the rewrite decision, which is still accurate. The one behavior a user could previously rely on — turning the policy off to keep using a stale rewritten client — is gone by design: with the policy off the desktop stops installing the rewrite.
- A paired remote browser now receives `sidebar_open` pushes live; the socket shows the same gate behaviour as its two siblings (403 unpaired, proxied when paired).
- API-filed bug reports with a complete template survive the enforcer. A report that genuinely skips the template is still closed, which is the enforcer's purpose.
- The `wsPaths`/`REMOTE_UPGRADE_PATHS` pair is now mechanically coupled by a test, so the failure mode in #1646 fails loudly at review time rather than silently at runtime.

## Testing

- `packages/dsh-remote-web-ui/tests/remote-api.spec.ts`: an unpaired request is refused even with the LAN policy off; a paired device keeps working and loses access the moment `stop()` lands; a paired device may still write the settings bridge while the same write from an unpaired caller is refused before the proxy leg; the control planes stay denied to a paired device while the configuration plane proxies.
- `packages/dsh-remote-web-ui/tests/remote-upgrade.spec.ts`: an unpaired upgrade is refused with `403 Forbidden` and never reaches the upstream, replacing the test that asserted the policy-off bypass.
- `packages/dsh-remote-web-ui/tests/remote-channel.spec.ts` and `tests/remote-channel-boot.spec.ts`: `/sidebar/ws/agent-opens` rewrites in both the runtime patch and the generated boot script.
- `packages/dsh-remote-web-ui/tests/remote-contract.spec.ts`: the upgrade-route set is derived from `wsPaths` and asserted equal, and the three sidebar sockets are pinned by name.
- Package suite: 379 tests across 34 files green, plus `typecheck`.
- The enforcer change is workflow YAML and carries no unit test; it was verified by reading the two workflow triggers and the form's `labels:` key, and by reproducing the race against the two closed issues.
