# DSH Remote Web UI

English | [中文](README.zh.md)
> Remote access for the dsh web GUI that shares **one interface**: pair a phone or another computer from a QR beside the settings button, and both run the same official Web GUI this machine runs — phones get an injected portrait-touch adaptation, PCs get the full desktop — through one-time pairing tokens and revocable device sessions. A settings toggle binds the server to the LAN, an optional Cloudflare quick tunnel reaches the internet, and the sidebar checks for a newer dsh-web release with one-click self-update.

This repository is an external plugin package for DeepSeek Harness (DSH). It is a single dual-face package: the host half owns pairing tokens, device sessions, the `/api/pair` route family, the gated `/remote` channel, the LAN bind toggle, and the `/api/update` surface; the browser half renders the sidebar-foot entries (the download trigger and the remote-access entry beside the settings button), the pairing panel with a QR code, live device status, the authorized-device roster, the settings card, the portrait-touch adaptation layer over the official UI, and the update panel.

## What it does

- **Entry**: a phone icon beside the settings button in both the expanded sidebar and the narrow rail; its tooltip and accessible label say "Remote access".
- **Panel**: "Remote access" title, a "Pair a device" card with the status area ("Waiting for a device" + status badge), a large QR code, the pairing link with its copy button, Stop / Refresh QR actions, and the authorized-device roster (a device name inferred from User-Agent, online/offline, last active time, per-device unpair). Credential-bearing device ids and raw User-Agent values are never rendered. Both the phone and the PC use the same single-use link.
- **Phone side**: scanning the QR binds the phone with a one-time, time-limited token and reloads into the **official Web GUI** — there is no second interface to drift from. While the phone is in portrait, the plugin injects a touch-adaptation layer over the running UI (see "The mobile adaptation layer" below). The accept chain is cookieless (`/pair-accept` → `/pair-app`): the plugin itself serves the official shell, so the phone needs no harness browser-auth cookie at all. A reopen service worker (https origins) then owns later navigations to `/` from history, bookmarks, or tab restore, so the phone reopens straight into the app instead of a 401 dead end (see Security model).
- **PC side**: the same link opens the full desktop Web GUI on another computer over the gated `/remote` channel; unpaired PCs see a guided blocking page (with a manual pair-token input) and no workspace data behind it.
- **Security**: one active token at a time (a refresh invalidates the old link; the link stays re-usable within its expiry window so a scan handed between browsers can complete pairing; it expires). 停止 revokes every paired device and the current token — the `/remote` channel cuts them off on their next request. Pairing is this plugin's access control for the `/remote` channel; direct `/api` on a LAN-exposed bind is governed by the harness fence + browser auth (see Security model). Loopback (127.0.0.1) keeps using `/api` directly. A paired device is a **full-control credential** (see Security model).
- **LAN bind toggle**: the settings card writes a managed block into the profile `cordis.patch.yml` that pins the webserver bind to `0.0.0.0` (on) or `127.0.0.1` (off) — no `--host` command-line dance; an explicit `--host`/`--port` flag still wins. It maintains the matching host firewall rule (Windows Defender via netsh; Linux firewalld/ufw/iptables; other platforms report the firewall as unmanaged) and shows the live bind, the reachable LAN URLs, and the firewall state.
- **Live status**: the desktop badge flips to 已连接 in real time; an `/api` posture probe reports any host whose `/api` fence the SDK leaves open, and the auto-tunnel state appears on the panel while the tunnel is starting.
- **One-click self-update**: the sidebar download trigger checks for a newer dsh-web release after load, marks the button when one exists, and runs the verified update (release notes shown in the panel).

## The mobile adaptation layer

The official desktop layout already auto-collapses the sidebar below 1024px. On top of that, while the viewport is portrait + coarse pointer + narrower than 1100px the plugin injects:

- a CSS sheet keyed on CSS-Modules **semantic suffixes** (`[class$="_composerSeat"]`) so the selectors survive official rebuilds that only change hashes: 44px touch targets on the collapsed rail, 16px inputs (prevents iOS focus zoom), safe-area padding for the composer, compact type for the message list and sidebar, a column layout for the settings modal, and a full-width PlanReview card;
- a **draggable whale button** as the entry to the collapsed sidebar (position persisted; wired to the official `ctx.layout.toggleSidebar()`), hidden while the sidebar is expanded;
- **gestures**: left-swipe collapses the sidebar, right-swipe in the conversation opens it; long-pressing a session row opens the same action menu as the desktop ellipsis; tapping a session row or anywhere outside the sidebar collapses it again;
- **input behavior for touch**: Enter only inserts a newline (send goes through the send button), programmatic composer focus is suppressed (no spurious keyboards), and official tooltip bubbles are hidden because taps leave them stuck;
- **mobile plugin scope**: while the layer is active, the right-hand details column and the desktop-oriented tool surfaces (SSH terminal, skill explorer, task board, git graph, pet, perf, usage) are hidden - keyed on the L2 semantic roots (`data-dsh-plugin`), so ownership stays with the declaring plugin and class churn cannot resurrect them. These are render suppressions; the client bundles still load. Activation also closes the details panel through the official `ctx.layout.closeDetails()`.
- a **manual opt-out**: `sessionStorage.dsh-remote-force-desktop = 1` disables the whole layer; landscape, desktop, and wide viewports are never touched.

The paired remote desktop also runs in **host mode**: on this harness line the "configuration plane is local" behavior is a client-side branch on `connection.isLoopback`, and the channel boot script installs the transport hook (`__DSH_TRANSPORT__.ownsHost = true`) on non-loopback origins before any boot entry. Settings, credentials, agent presets, and deliverables therefore work on the phone exactly as on the desktop — every call still rides the gated `/remote` channel. Four control planes stay physically local: `/api/pair/*`, `/api/update/*`, `/api/plugin-manager/*`, and `/api/dsh-desktop-launcher/*`.

## Requirements

- A DSH installation whose `dsh` CLI supports profiles (`dsh --profile`, `dsh plugin`) — the profile/bundle mechanism this package rides on.
- For LAN use, either flip the **局域网访问** toggle in the settings card (writes the bind block; effective from the next `dsh web` start) or start with `dsh web --host 0.0.0.0`. With the default `127.0.0.1` bind the panel shows an explicit explanation instead of a dead QR code — unless a public base URL is configured (see "Remote access over the internet" below), which makes the QR reachable from anywhere without rebinding. The panel's mint/stop endpoints are loopback-only by design: a desktop browser opened at the LAN URL sees a "配对面板仅限本机使用" banner.
- For the one-click public tunnel (`autoTunnel`), the `cloudflared` platform binary ships with the package (its postinstall downloads it; a runtime download covers installers that skip postinstall scripts). No user-side tooling, account, or domain is needed.

## Install

Install the family aggregate package `@linxin666/dsh-web-all` (all plugins and skins in one) or this plugin alone:

```sh
# Recommended: install directly from npm
dsh plugin --profile web add @linxin666/dsh-remote-web-ui@latest

# Or from the repository (development loop)
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-remote-web-ui
```

Restart the profile (`dsh web`), then open the phone icon in the sidebar foot. The plugin's `cordis.patch.yml` inserts the single plugin row that mounts both halves.

> `github:<org>/<repo>` installs work for a standalone repo whose package sits at the root (the `prepare` script builds `lib/` during install; pnpm ≥10 blocks that until you copy the printed key into the profile's `pnpm-workspace.yaml` `allowBuilds` and re-run). Monorepo subpackages use the `link:` form above.

## Use

1. Open the settings card (设置 → Web 插件 → 远程访问设置) and flip **局域网访问** on if the server binds loopback; the card shows the live bind, the firewall state, and the reachable LAN URLs. The bind change takes effect from the next `dsh web` start.
2. Start `dsh web`, click the phone icon, and the panel mints a fresh one-time QR.
3. Scan with the phone (or open the copied link): the device pairs and boots the **official Web GUI** served cookieless by the plugin (`/pair-accept` → `/pair-app`), which reloads into `/`. On a phone, the portrait adaptation layer is already active — same layout as the desktop, same live state. Later reopens from history or a bookmark go straight back into the app (https origins; see Security model).
4. **To pair a PC instead**: copy the same link and open it in a browser on the other computer. After the same round trip the full Web GUI runs there over the gated `/remote` channel; unpaired PCs see the guided blocking page and no data. One active token pairs one device; mint a fresh QR for the next device.
5. The desktop badge flips to 已连接 in real time; the device roster lists the paired devices with per-device 取消配对, and 停止 revokes everything.
6. Configure pairing lifetime, device limits, the LAN fence policy (`requirePairingForLan`), the public base URL, and the auto tunnel in the same settings card.

## Remote access over the internet (tunnels)

### One-click public tunnel (recommended)

Set **自动公网隧道** (autoTunnel) in the settings card. The plugin runs its own Cloudflare quick tunnel (`cloudflared` ships with the package), feeds the minted public URL into the QR base and the pairing fence dynamically, and keeps the posture probe informed — a phone anywhere can pair at any time. The manual public address below is ignored while this is on.

### Manual tunnels (bring your own)

Expose the local port with any tunnel and set **公网地址** (publicBaseUrl), e.g.:

```sh
# 1. Expose the local port (whatever dsh web is listening on):
cloudflared tunnel --url http://127.0.0.1:3080
#    prints something like: https://xxxx-xxxx-xxxx.trycloudflare.com

# 2. Start dsh web as usual. Do not add --trusted-host for the tunnel
#    domain unless you intentionally want the SDK to trust that host for
#    /api. Keep the LAN bind off if only tunnel access is wanted.
```

Then set the printed URL as 公网地址. The QR link is built from it, and the plugin's pairing fence accepts the tunneled authority. The posture probe keeps auditing which `/api` authorities the SDK fence leaves open.

## Development

Work from this repository (no sibling checkout needed):

```sh
cd dsh-web
export NPM_TOKEN='<token>'   # only if private @deepseek-ai auth is still required
pnpm install
pnpm --filter @linxin666/dsh-remote-web-ui run build
pnpm --filter @linxin666/dsh-remote-web-ui test
pnpm --filter @linxin666/dsh-remote-web-ui run typecheck
```

The peer APIs come from the official NPM SDK: every `@deepseek-ai/*` package used here is declared in devDependencies (0.1.2-alpha.2 cohort), and TypeScript/Vitest resolve types straight from node_modules — no DSH source checkout is required. The consumer-side `prepare` build (`tsdown.prepare.config.ts`) transpiles without type checking, so git installs work without any harness checkout either.

## Checks

```sh
pnpm run typecheck
pnpm test
pnpm run build
```

## Harness contract dependencies

Pinned to the 0.1.2-alpha.2 line; the seams this build relies on:

- **`sidebar.footer.action` foot seat** (the 0.1.2 shell composition): the sidebar declares and renders the seat the remote entry occupies.
- **`ctx.layout.toggleSidebar()`** (packages/client/ui-layout): the whale button expands the collapsed sidebar through the official panel-action face.
- **`ctx.connection.authenticatedUrl()`** (packages/client/connection): the sanctioned launch-token seam the proxy redeems once for its inner credential (`src/inner-auth.ts`), so re-issued `/api` calls satisfy the harness browser-auth check.
- **`__DSH_TRANSPORT__.ownsHost`** (client-connection transport hooks): the host-mode flip for paired remote desktops. There is no host-side per-method privilege pin on this line — the configuration plane branches on `connection.isLoopback` in the client — and no `api/gate` waterfall either (the gate listener stays mounted for deployments that gain the seam; pairing enforcement lives on this plugin's own `/remote` channel).
- **User-patch bind semantics**: same-id patch rows replace the row config wholesale, and the user patch layer cannot evaluate `webStartup`-dependent `!!js` expressions reliably — the LAN bind block therefore materializes static values and the plugin re-asserts it every boot.

The fence helpers (`isTrustedApiRequest` / `isLoopbackHostname`) are reimplemented locally in `src/gate.ts` / `src/routes.ts`: the connection plugin stopped exporting them, so the pairing routes carry their own copy scoped to the literals the QR links advertise.

## Manual E2E: LAN pairing round trip

The unit/component specs cover the route family, the gate, the channel, the lan-bind block, and the adaptation layer, but the pairing loop involves a real browser on a non-loopback origin. Repeat this after any change to the wire contract or the connection loop:

1. Start an isolated instance: `DSH_HOME=/tmp/dsh-qa dsh --profile web --no-open --port 3191` with the LAN bind toggle on (or a profile whose bind block pins 0.0.0.0).
2. Open the **loopback** URL (`http://127.0.0.1:3191`) in a browser: the phone icon sits in the sidebar foot; the panel mints a QR whose link is `<lan-url>/pair-accept?pair=<token>`.
3. In a second tab under mobile emulation (390x844, touch) open that link: the chain `/pair-accept → /pair-app?device=<id> → /` sets the device cookie, serves the patched official shell, and boots the UI — `document.body.classList` carries `dsh-remote-portrait`, the adaptation stylesheet and the whale button exist, and `__DSH_TRANSPORT__.ownsHost` is `true`. The settings surface renders host data (host mode), not a memory mirror. In an https deployment the shell also registers the reopen service worker (`/pair-app.sw.js`); reloading `/` in that tab boots the app instead of the harness 401.
4. The desktop badge flips to 已连接 in real time; a LAN-origin desktop page instead shows the 配对面板仅限本机使用 banner and opens no status stream.
5. 停止 on the desktop cuts the device off: its next request 403s with `unpaired` (the fence page offers the manual pair-token input).

The public path is the same round trip through a tunnel (see "Remote access over the internet"): loopback mint → device opens the public QR URL → accept → official UI. Only `publicBaseUrl` (plugin config) names the tunneled host; `--trusted-host` is not part of this pairing flow. The desktop panel still opens at `http://127.0.0.1`.

## Security model

- **Pairing is the access control for the `/remote` channel**: while `requirePairingForLan` is on (default), every request must carry a live paired-device cookie, enforced before any bytes are forwarded. A missing or revoked session receives HTTP 403 with a JSON rejection carrying `error.code: "unpaired"`; the browser's `EventSource` API exposes only the stream failure, not that response body.
- **The channel carries the process's own inner credential.** The harness browser-auth cookie is authority-bound (minted for the exact `host:port` a browser visited) and has no loopback exemption, so a proxied re-issue to `127.0.0.1` cannot reuse a device's cookie. The plugin therefore redeems its own launch token once — the same exchange a first browser visit performs — and attaches that cookie to re-issued requests. The credential is only ever exercised behind the pairing gate above; 停止/取消配对 immediately stop exercising it.
- **Cohort reality: pairing does not gate direct `/api`.** On the pinned 0.1.2-alpha.2 line nothing emits the `api/gate` seam, so a direct `/api` call from a LAN origin is governed solely by the harness fence (which auto-trusts LAN literals under a `0.0.0.0` bind) plus the harness browser-auth cookie. A browser credential a device has already redeemed therefore survives 停止/取消配对 until its natural expiry (30 days) — revocation binds the `/remote` channel and the pairing cookie, not that credential. The plugin probes the `/api` posture and warns loudly; treat a LAN-exposed bind as a deliberate decision, and prefer loopback plus tunnels when the machine is shared.
- **A paired device is a full-control credential.** With host mode active it reaches the complete host API — chat, sessions, settings, credentials, agent presets, deliverables — mirroring the SDK's own stance that a loopback desktop is trusted. Only the four control planes (pairing, self-update, plugin install/remove, desktop launcher) stay physically local. Only pair devices you control; 停止 or per-device 取消配对 revokes immediately.
- **Control endpoints stay loopback-only**: mint/stop/revoke, the device roster, the lan-bind status, and the update endpoints answer only to loopback. A LAN-origin browser sees the "配对面板仅限本机使用" banner.
- **The app landing is cookieless-optional.** After pairing, the QR lands the device on `/pair-app`, served by this plugin: the official shell is delivered without passing the harness index gate, and the device credential rides a `x-dsh-remote-device` header (fetch) / `device` query (WebSocket upgrades) that the boot patch attaches from sessionStorage. The flow therefore works when the device browser blocks all cookies; the pairing cookie remains the primary credential where the browser stores it, and the harness browser-auth cookie is no longer required on the phone path at all.
- **Reopens are owned by a service worker (https origins).** A paired phone returning from history, a bookmark, or tab restore navigates to bare `/` — a path the plugin does not own, where the harness fallback seat answers with its browser-auth 401 (the cookieless flow never holds that credential). The app shell therefore registers `/pair-app.sw.js` (fenced like `/pair-app`; the script is inert logic with no secrets): it intercepts navigations to `/` only, re-serves the shell network-first through `/pair-app` — which re-validates the device cookie and refreshes its presence, so every reopen also keeps the session alive — falls back to the cached shell offline, and passes the navigation through when the plugin no longer answers (a revoked device then sees the harness response or the bilingual re-scan page). Plain-HTTP LAN origins are not secure contexts and never register the worker; there a reopen means scanning a fresh QR.
- **Revocation is per-request**: a paired device whose request is already in flight when 停止 lands completes that request; the next one 403s.
- **Paired device sessions persist by default**: device sessions (not the one-time QR token) are written to `$DSH_HOME/remote-web-ui-devices.json` (0600, temp file + atomic rename). A paired cookie still works after a `dsh web` restart. Refreshing the QR still mints a new token; restarting does not restore the current QR. Sessions idle for `idleExpireMs` (default 30 days; the reopen service worker refreshes the window on every navigation it serves) are deleted and must pair again. Device ids are session credentials. Override `devicesFile` with another absolute path when needed. Changing `cookieName` invalidates existing devices (expected).
- **The LAN bind block owns the webserver row**: while the toggle has been flipped, the managed block pins the bind; the plugin re-asserts it each boot so explicit `--host`/`--port` flags win by rewriting the block. Hand-editing the block is detected and surfaced in the card (`blockHost` shows the literal).
- **The desktop gate policy is public**: `/api/pair/status` exposes only the boolean `requirePairingForLan` policy so a remote desktop can choose the correct transport before its settings scope is available. This field is not a credential and does not expose tokens, devices, counts, or tunnel URLs.
- **Quick-tunnel hostnames change per run**: a `trycloudflare.com` URL is random on every `cloudflared` start, so `publicBaseUrl` (or the auto tunnel) must be refreshed with it. A named tunnel avoids the churn.

## Known Limitations and Deferred Work

- **The bind change needs a restart**: the live patch watcher cannot rebind a listening socket, and hot reload behavior is profile-shape dependent. The card shows 局域网访问 will apply after the next `dsh web` start (`pendingRestart`).
- **Plain-HTTP LAN reopens need a re-scan**: the reopen service worker registers only on secure contexts (https tunnels, localhost); a phone paired over a plain-HTTP LAN URL that navigates back to `/` hits the harness 401 and must scan a fresh QR. Pairing again is cheap in-network and restores everything.
- **The adaptation selectors track the official build**: the semantic-suffix strategy survives hash churn but not semantic renames; each official GUI update needs a visual QA pass (per the dsh-LAN reference, these suffixes have been stable across many official releases).
- **Dev HMR**: `dsh web --dev` polls every roster bundle by path, so rebuilding this package (its own `tsdown --watch`) hot-reloads the client bundle; the host half needs a restart.

## Dependency rationale

`qrcode.react` (MIT, actively maintained, React 16–19 support) renders the QR as a dependency-free SVG component — no canvas, no server-side image generation. It is inlined into the client bundle at build time (like the official skin/turtle-ui plugins inline their non-shared deps), so profile installations need no extra runtime dependency beyond the dsh peer closure. `schemastery` is the DSH-standard config schema validator.

## Telemetry

The browser half sends one anonymous install heartbeat per UTC day to dsh-market.com: a random localStorage id plus this package's name, nothing else. The server stores only a salted hash of that id, never IP addresses, and exposes aggregate counts only. See [docs/telemetry.md](../../docs/telemetry.md) for the full contract.