# DSH Remote Web UI

English | [中文](README.zh.md)
> Remote access for the dsh web GUI that shares **one interface**: pair a phone or another computer from a QR beside the settings button, and both run the same official Web GUI this machine runs — phones get an injected portrait-touch adaptation, PCs get the full desktop — through time-limited pairing tokens and revocable device sessions. A settings toggle binds the server to the LAN, an optional Cloudflare quick tunnel reaches the internet — fronted by a never-changing stable hostname so the phone's bookmark and pairing survive restarts with zero setup — and the sidebar checks for a newer dsh-web release with one-click self-update.

This repository is an external plugin package for DeepSeek Harness (DSH). It is a single dual-face package: the host half owns pairing tokens, device sessions, the `/api/pair` route family, the gated `/remote` channel, the LAN bind toggle, and the `/api/update` surface; the browser half renders the sidebar-foot entries (the download trigger and the remote-access entry beside the settings button), the pairing panel with a QR code, live device status, the authorized-device roster, the settings card, the portrait-touch adaptation layer over the official UI, and the update panel.

## What it does

- **Entry**: a phone icon beside the settings button in both the expanded sidebar and the narrow rail; its tooltip and accessible label say "Remote access".
- **Panel**: "Remote access" title, a "Pair a device" card with the status area ("Waiting for a device" + status badge), a large QR code, the pairing link with its copy button, Stop / Refresh QR actions, and the authorized-device roster (a device name inferred from User-Agent, online/offline, last active time, per-device unpair). Credential-bearing device ids and raw User-Agent values are never rendered. Both the phone and the PC use the same time-limited link: until it expires or the QR is refreshed, that link can pair several devices, each with its own device session.
- **Phone side**: scanning the QR binds the phone with a time-limited token and reloads into the **official Web GUI** — there is no second interface to drift from. While the phone is in portrait, the plugin injects a touch-adaptation layer over the running UI (see "The mobile adaptation layer" below). The accept chain is cookieless (`/pair-accept` → `/pair-app`): the plugin itself serves the official shell, so the phone needs no harness browser-auth cookie at all. A reopen service worker (https origins) then owns later navigations to `/` from history, bookmarks, or tab restore, so the phone reopens straight into the app instead of a 401 dead end (see Security model).
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
- **mobile plugin scope**: while the layer is active, the right-hand details column and the desktop-oriented tool surfaces (SSH terminal, skill explorer, task board, git graph, pet, usage) are hidden - keyed on the L2 semantic roots (`data-dsh-plugin`), so ownership stays with the declaring plugin and class churn cannot resurrect them. These are render suppressions; the client bundles still load. Activation also closes the details panel through the official `ctx.layout.closeDetails()`.
- a **manual opt-out**: `sessionStorage.dsh-remote-force-desktop = 1` disables the whole layer; landscape, desktop, and wide viewports are never touched.

The paired remote desktop also runs in **host mode**: on this harness line the "configuration plane is local" behavior is a client-side branch on `connection.isLoopback`, and the channel boot script installs the transport hook (`__DSH_TRANSPORT__.ownsHost = true`) before any boot entry. Host mode is **server-granted**: the hook is installed only when the device-gated app landing (`/pair-app`) published the grant marker ahead of the boot patch, so a shell served to an unpaired browser — a fence-open deployment — never poses as the machine owner. Settings, credentials, agent presets, and deliverables therefore work on the phone exactly as on the desktop — every call still rides the gated `/remote` channel. Three control planes stay physically local: `/api/pair/*`, `/api/update/*`, and `/api/plugin-manager/*`.

## Requirements

- A DSH installation whose `dsh` CLI supports profiles (`dsh --profile`, `dsh plugin`) — the profile/bundle mechanism this package rides on.
- For LAN use, either flip the **局域网访问** toggle in the settings card (writes the bind block; effective from the next `dsh web` start) or start with `dsh web --host 0.0.0.0`. With the default `127.0.0.1` bind the panel shows an explicit explanation instead of a dead QR code — unless a public base URL is configured (see "Remote access over the internet" below), which makes the QR reachable from anywhere without rebinding. The panel's mint/stop endpoints are loopback-only by design: a desktop browser opened at the LAN URL sees a "配对面板仅限本机使用" banner.
- For the one-click public tunnel (`autoTunnel`), the `cloudflared` platform binary ships with the package (its postinstall downloads it; a runtime download covers installers that skip postinstall scripts). No user-side tooling, account, or domain is needed.
- The same binary also powers the fixed-hostname named-tunnel mode (`tunnelToken`): the public hostname never changes, so a paired phone keeps its bookmark and its pairing cookie across restarts and never re-pairs.

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
2. Start `dsh web`, click the phone icon, and the panel mints a fresh time-limited QR.
3. Scan with the phone (or open the copied link): the device pairs and boots the **official Web GUI** served cookieless by the plugin (`/pair-accept` → `/pair-app`), which reloads into `/`. On a phone, the portrait adaptation layer is already active — same layout as the desktop, same live state. Later reopens from history or a bookmark go straight back into the app (https origins; see Security model).
4. **To pair a PC instead**: copy the same link and open it in a browser on the other computer. After the same round trip the full Web GUI runs there over the gated `/remote` channel; unpaired PCs see the guided blocking page and no data. One active token pairs one device; mint a fresh QR for the next device.
5. The desktop badge flips to 已连接 in real time; the device roster lists the paired devices with per-device 取消配对, and 停止 revokes everything.
6. Configure pairing lifetime, device limits, the LAN fence policy (`requirePairingForLan`), the public base URL, the auto tunnel, the stable-hostname relay, and the named-tunnel token in the same settings card.

## Remote access over the internet (tunnels)

A tunnel process restart — most often a mobile network dropping and reconnecting — used to drop the public host from the pairing fence the moment the tunnel left `running`, so the address still printed in the QR code answered 403, including on the deliberately public `/api/pair/status` (issue #1547). A named tunnel's fixed hostname and a registered relay origin never change, so both now stay trusted throughout the reconnect; a quick tunnel's previous host stays trusted for a 60 s grace window, because the edge may still be delivering a connection the phone already opened, and is dropped only if the tunnel has not come back by then.

### One-click public tunnel (recommended)

Set **自动公网隧道** (autoTunnel) in the settings card. The plugin runs its own Cloudflare quick tunnel (`cloudflared` ships with the package), feeds the minted public URL into the QR base and the pairing fence dynamically, and keeps the posture probe informed — a phone anywhere can pair at any time. The manual public address and the named-tunnel token below are ignored while this is on. The minted hostname is ephemeral and changes on every `dsh web` restart — the stable-hostname relay below keeps the phone's origin fixed across those restarts.

### Stable-hostname relay (default on; pair once across restarts)

While the quick tunnel runs, the plugin additionally registers its current tunnel URL with the dsh-market relay registry and rebuilds the QR on a fixed origin — `https://<id>.dsh-market.com` — minted once per profile and stored under `$DSH_HOME/remote-web-ui-registry/`. The hostname never changes, so the phone's bookmark and its pairing cookie keep working across `dsh web` restarts with no Cloudflare account, no dashboard, and no domain of your own.

- Registration is secret-authenticated: the plugin mints a 256-bit secret next to the identity and re-syncs the mapping on every tunnel start (crash restarts included) with capped backoff. If the registry is unreachable, the QR falls back to the raw quick URL for that session and the panel says so.
- A phone opening the stable origin while the instance is offline sees an explicit "instance offline — refresh in a moment, no re-pairing needed" page instead of a dead link.
- Turn **固定域名中继** (relay) off in the settings card to keep the deployment entirely on the ephemeral origin; the registry row is removed at once. Trust note: relayed traffic transits the dsh-market edge (a Cloudflare Worker operated by the package author) — see Security model.

### Fixed-hostname named tunnel (bring your own domain)

The relay above already fixes the phone's origin on a shared dsh-market subdomain. A Cloudflare named tunnel is the alternative for deployments that want a hostname on **their own** domain: its public hostname is permanent, so the phone's bookmark and its pairing cookie keep working across `dsh web` restarts — pair once, never again (until the session idles past `idleExpireMs`).

1. In the Cloudflare dashboard create a Tunnel and map a public hostname — e.g. `dsh.example.com` — to `http://127.0.0.1:3080` (the port `dsh web` listens on).
2. Copy the tunnel's token and paste it into **固定域名隧道令牌** (tunnelToken) in the settings card.
3. Set the same hostname as **公网地址** (publicBaseUrl). The token does not carry the hostname, so without this step the tunnel stays off and a warning names the missing piece.

The plugin then runs `cloudflared tunnel run --token` with the same lifecycle management as the quick tunnel: the binary ships with the package, unexpected exits restart with backoff, and the posture probe audits the `/api` fence for the fixed host. The token is stored as a settings secret and read back redacted. The auto quick tunnel takes precedence while it is on.

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
- **`__DSH_FILE_UPLOAD__`** (file-upload client hooks): the optional pre-Cordis transport the upload service reads once at construction. The remote boot patch publishes it so background uploads stay on the rewritten main-thread fetch instead of a Web Worker that escapes the channel (issue #1580).
- **`__DSH_TRANSPORT__.ownsHost`** (client-connection transport hooks): the host-mode flip for paired remote desktops. It is installed only when the device-gated app landing published the `__DSH_REMOTE_HOST_GRANT__` marker ahead of the boot patch, so the flip is server-granted rather than asserted from the origin. There is no host-side per-method privilege pin on this line — the configuration plane branches on `connection.isLoopback` in the client — and no `api/gate` waterfall either (the gate listener stays mounted for deployments that gain the seam; pairing enforcement lives on this plugin's own `/remote` channel).
- **User-patch bind semantics**: same-id patch rows replace the row config wholesale, and the user patch layer cannot evaluate `webStartup`-dependent `!!js` expressions reliably — the LAN bind block therefore materializes static values and the plugin re-asserts it every boot.

The fence helpers (`isTrustedApiRequest` / `isLoopbackHostname`) are reimplemented locally in `src/gate.ts` / `src/routes.ts`: the connection plugin stopped exporting them, so the pairing routes carry their own copy scoped to the literals the QR links advertise.

## Manual E2E: LAN pairing round trip

The unit/component specs cover the route family, the gate, the channel, the lan-bind block, and the adaptation layer, but the pairing loop involves a real browser on a non-loopback origin. Repeat this after any change to the wire contract or the connection loop:

1. Start an isolated instance: `DSH_HOME=/tmp/dsh-qa dsh --profile web --no-open --port 3191` with the LAN bind toggle on (or a profile whose bind block pins 0.0.0.0).
2. Open the **loopback** URL (`http://127.0.0.1:3191`) in a browser: the phone icon sits in the sidebar foot; the panel mints a QR whose link is `<lan-url>/pair-accept?pair=<token>`.
3. In a second tab under mobile emulation (390x844, touch) open that link: the chain `/pair-accept → /pair-app?grant=<one-time> → /` sets the device cookie, spends the grant, serves the patched official shell, and boots the UI — `document.body.classList` carries `dsh-remote-portrait`, the adaptation stylesheet and the whale button exist, and `__DSH_TRANSPORT__.ownsHost` is `true`. The settings surface renders host data (host mode), not a memory mirror. In an https deployment the shell also registers the reopen service worker (`/pair-app.sw.js`); reloading `/` in that tab boots the app instead of the harness 401.
4. The desktop badge flips to 已连接 in real time; a LAN-origin desktop page instead shows the 配对面板仅限本机使用 banner and opens no status stream.
5. 停止 on the desktop cuts the device off: its next request 403s with `unpaired` (the fence page offers the manual pair-token input).

The public path is the same round trip through a tunnel (see "Remote access over the internet"): loopback mint → device opens the public QR URL → accept → official UI. Only `publicBaseUrl` (plugin config) names the tunneled host; `--trusted-host` is not part of this pairing flow. The desktop panel still opens at `http://127.0.0.1`.

## Security model

- **Pairing is the access control for the `/remote` channel, unconditionally**: every request must carry a live paired-device cookie, enforced before any bytes are forwarded. A missing or revoked session receives HTTP 403 with a JSON rejection carrying `error.code: "unpaired"`; the browser's `EventSource` API exposes only the stream failure, not that response body. This gate does **not** follow `requirePairingForLan`: the channel re-issues every call with the process's own browser-auth credential, so admitting an unpaired caller would hand out that authority. The LAN policy governs the plain `/api` surface only and can never widen the channel (issue #1665).
- **The channel carries the process's own inner credential.** The harness browser-auth cookie is authority-bound (minted for the exact `host:port` a browser visited) and has no loopback exemption, so a proxied re-issue to `127.0.0.1` cannot reuse a device's cookie. The plugin therefore redeems its own launch token once — the same exchange a first browser visit performs — and attaches that cookie to re-issued requests. The credential is only ever exercised behind the pairing gate above; 停止/取消配对 immediately stop exercising it.
- **Cohort reality: pairing does not gate direct `/api`.** On the pinned 0.1.2-alpha.2 line nothing emits the `api/gate` seam, so a direct `/api` call from a LAN origin is governed solely by the harness fence (which auto-trusts LAN literals under a `0.0.0.0` bind) plus the harness browser-auth cookie. A browser credential a device has already redeemed therefore survives 停止/取消配对 until its natural expiry (30 days) — revocation binds the `/remote` channel and the pairing cookie, not that credential. The plugin probes the `/api` posture and warns loudly; treat a LAN-exposed bind as a deliberate decision, and prefer loopback plus tunnels when the machine is shared.
- **A paired device is a full-control credential.** With host mode active it reaches the complete host API — chat, sessions, settings, credentials, agent presets, deliverables — mirroring the SDK's own stance that a loopback desktop is trusted. Only the three control planes (pairing, self-update, plugin install/remove) stay physically local. Only pair devices you control; 停止 or per-device 取消配对 revokes immediately.
- **Control endpoints stay loopback-only**: mint/stop/revoke, the device roster, the lan-bind status, and the update endpoints answer only to loopback. A LAN-origin browser sees the "配对面板仅限本机使用" banner.
- **Background file uploads ride the channel too.** The official upload service prefers a Web Worker carrier whose own globals no main-thread patch reaches, so the boot patch (and the browser patch as a fallback) publishes the official pre-Cordis hook `__DSH_FILE_UPLOAD__` and hands it the patched `fetch`: the raw `/api/session/uploadFileBinary` POST is rewritten onto `/remote` and carries the device credential exactly like every other gated call. Without the hook a paired browser's uploads bypass the channel and the harness browser-auth fence answers 401 (issue #1580). The hook is only published on non-loopback origins, only while the channel is installed, and never overwrites a hook the page already owns.
- **The landing URL carries a one-time grant, never the device id.** `/pair-accept` mints a 256-bit, single-consume grant with a 60 s TTL and redirects to `/pair-app?grant=<g>`; the landing spends it — delete-on-attempt, so a replayed or expired grant resolves to nothing — and hands the device id to the shell in its own response. A device id is a live session credential, so it never enters a URL, the address bar, or any log on the redirect path. The pairing cookie is `Secure` whenever the request arrived over TLS (`x-forwarded-proto: https`) and plain over LAN HTTP, where a Secure cookie would simply be dropped by the browser.
- **The app landing is cookieless-optional.** After pairing, the QR lands the device on `/pair-app`, served by this plugin: the official shell is delivered without passing the harness index gate, and the device credential rides a `x-dsh-remote-device` header (fetch) / `device` query (WebSocket upgrades) that the boot patch attaches from sessionStorage. The flow therefore works when the device browser blocks all cookies; the pairing cookie remains the primary credential where the browser stores it, and the harness browser-auth cookie is no longer required on the phone path at all.
- **Reopens are owned by a service worker (https origins).** A paired phone returning from history, a bookmark, or tab restore navigates to bare `/` — a path the plugin does not own, where the harness fallback seat answers with its browser-auth 401 (the cookieless flow never holds that credential). The app shell therefore registers `/pair-app.sw.js` (fenced like `/pair-app`; the script is inert logic with no secrets): it intercepts navigations to `/` only, re-serves the shell network-first through `/pair-app` — which re-validates the device cookie and refreshes its presence, so every reopen also keeps the session alive — falls back to the cached shell offline, and passes the navigation through when the plugin no longer answers (a revoked device then sees the harness response or the bilingual re-scan page). Plain-HTTP LAN origins are not secure contexts and never register the worker; there a reopen means scanning a fresh QR.
- **Revocation is per-request**: a paired device whose request is already in flight when 停止 lands completes that request; the next one 403s.
- **Paired device sessions persist by default**: device sessions (not the time-limited QR token) are written to `$DSH_HOME/remote-web-ui-devices.json` (0600, temp file + atomic rename). A paired cookie still works after a `dsh web` restart. Refreshing the QR still mints a new token; restarting does not restore the current QR. Sessions idle for `idleExpireMs` (default 30 days; the reopen service worker refreshes the window on every navigation it serves) are deleted and must pair again. Device ids are session credentials. Override `devicesFile` with another absolute path when needed. Changing `cookieName` invalidates existing devices (expected). A revocation that cannot be written to disk (read-only DSH_HOME, a full disk) removes the stale store instead of leaving a revoked session on disk, so the next start cannot restore it.
- **The LAN bind block owns the webserver row**: while the toggle has been flipped, the managed block pins the bind; the plugin re-asserts it each boot so explicit `--host`/`--port` flags win by rewriting the block. Hand-editing the block is detected and surfaced in the card (`blockHost` shows the literal).
- **The desktop gate policy is public, and it is not an access control**: `/api/pair/status` exposes only the boolean `requirePairingForLan` policy so a remote desktop can choose the correct transport before its settings scope is available. Turning it off makes the desktop ride plain `/api` (its own harness-fence posture); it never loosens the `/remote` channel, which always demands a paired credential. This field is not a credential and does not expose tokens, devices, counts, or tunnel URLs.
- **The device credential still rides the WebSocket query.** A WS handshake cannot carry headers from the Web API, so the cookieless credential travels as `?device=<id>`; the plugin's own `/remote` handler consumes it and never forwards it to the inner loopback request, but the origin access log, the relay Worker, and the Cloudflare edge still see a URL that authenticates as that device. Cookie-capable browsers authenticate the handshake by cookie instead. A short-lived single-use WS ticket is the planned replacement.
- **Quick-tunnel hostnames change per run**: a `trycloudflare.com` URL is random on every `cloudflared` start, so `publicBaseUrl` (or the auto tunnel) must be refreshed with it. The stable-hostname relay pins a fixed `<id>.dsh-market.com` origin in front of that ephemeral URL (default on with the auto tunnel); the named-tunnel mode (`tunnelToken`) is the own-domain alternative. The token itself is stored as a redacted settings secret — never logged, never echoed to the browser half.
- **The relay moves the origin, not the trust root**: with the relay on, the phone talks to `https://<id>.dsh-market.com`, a dsh-market Cloudflare Worker that looks up the instance's current tunnel URL and forwards request bytes verbatim — the pairing cookie and every application-level check stay on the instance, and the worker never terminates a pairing. What changes is the transit path: the relayed traffic passes infrastructure operated by the package author on Cloudflare's edge, so the author's worker can observe it — the same visibility Cloudflare itself has over a raw `trycloudflare.com` quick tunnel. The registry binds each id to a SHA-256 hash of a 256-bit secret (the plaintext lives only in `$DSH_HOME`, 0600), accepts only `*.trycloudflare.com` targets, rate-limits registrations, and stores nothing but the mapping; turn the relay off to leave the deployment entirely on the ephemeral origin.

## Known Limitations and Deferred Work

- **The bind change needs a restart**: the live patch watcher cannot rebind a listening socket, and hot reload behavior is profile-shape dependent. The card shows 局域网访问 will apply after the next `dsh web` start (`pendingRestart`).
- **Plain-HTTP LAN reopens need a re-scan**: the reopen service worker registers only on secure contexts (https tunnels, localhost); a phone paired over a plain-HTTP LAN URL that navigates back to `/` hits the harness 401 and must scan a fresh QR. Pairing again is cheap in-network and restores everything.
- **The adaptation selectors track the official build**: the semantic-suffix strategy survives hash churn but not semantic renames; each official GUI update needs a visual QA pass (per the dsh-LAN reference, these suffixes have been stable across many official releases).
- **Dev HMR**: `dsh web --dev` polls every roster bundle by path, so rebuilding this package (its own `tsdown --watch`) hot-reloads the client bundle; the host half needs a restart.

## Dependency rationale

`qrcode.react` (MIT, actively maintained, React 16–19 support) renders the QR as a dependency-free SVG component — no canvas, no server-side image generation. It is inlined into the client bundle at build time (like the official skin/turtle-ui plugins inline their non-shared deps), so profile installations need no extra runtime dependency beyond the dsh peer closure. `schemastery` is the DSH-standard config schema validator.

## Telemetry

The browser half sends one anonymous install heartbeat per UTC day to dsh-market.com: a random localStorage id plus this package's name, nothing else. The server stores only a salted hash of that id, never IP addresses, and exposes aggregate counts only. See [docs/telemetry.md](../../docs/telemetry.md) for the full contract.