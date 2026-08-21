# DSH Remote Web UI


English | [中文](README.zh.md)
> Remote access for phones and computers + one-click updates: pair a phone to use the current dsh web workspace remotely, or pair a computer browser through the same token to run the full Web GUI from another device; the sidebar checks for a newer dsh-web-ui release after it loads and marks the update button when one is available; clicking it updates the family.

This repository is an external plugin package for DeepSeek Harness (DSH):
pairing-based remote access for the dsh web GUI on phones and computers, plus
a one-click self-update for the dsh-web-ui family. It is a single
dual-face package — the host half owns pairing tokens, device sessions, the
`/api/pair` route family, the gated `/remote` desktop channel, and the
`/api/update` surface; the browser half renders the sidebar-foot entries (the
download trigger and an icon-only remote-access entry beside the settings
button), the pairing panel with a QR code, live device status, an
authorized-device list, and stop/refresh/copy actions, and the update panel
that probes and runs the update.

## What it does

- **Entry**: a phone icon beside the settings button in both the expanded sidebar and narrow rail; its tooltip and accessible label say "Remote access".
- **Panel**: "Remote access" title, "Pair a phone or another computer to access this workspace remotely" subtitle, a "Pair a device" card with the status area ("Waiting for a device" + status badge), a large QR code, separate phone (`/m/?pair=...`) and computer (`/?pair=...`) links with their own copy buttons, plus Stop / Refresh QR actions and an authorized-device list (a device name inferred from User-Agent, online/offline, last active time, per-device unpair). Credential-bearing device ids and raw User-Agent values are never rendered. Both links share one single-use token, so pairing either device invalidates the other link.
- **Phone side**: scanning the QR binds the phone with a one-time,
  time-limited token and lands it on the **standalone mobile surface at
  `/m/`** — a thin client purpose-built for a small screen (see
  [Screenshots](#screenshots)), not the desktop UI squeezed into a phone.
  The page is installable as a PWA. Each installed app uses its own
  paired-device cookie; a storage-isolated mobile web-app context pairs by
  opening a fresh QR link there or pasting a fresh desktop-issued link.
  The link carries a `workspace` parameter so the phone lands in the same
  workspace the desktop was looking at.
- **PC side (remote desktop pairing)**: the same QR link and pairing token
  also pair a PC browser — the phone flow extended to the desktop Web GUI.
  Copy the link from the panel and open it in a browser on another
  computer (LAN URL or tunnel URL); after the accept round trip the full
  Web GUI runs there — workspaces, sessions, chat, model switching — with
  its fenced same-origin traffic on the gated `/remote` channel instead of
  calling loopback-only host routes directly. The
  phone gets `/m/`, the PC gets the desktop UI: one token, one pairing
  flow, two surfaces. An unpaired PC sees a full blocking page with computer
  pairing steps and a retry action, with no workspace data rendered behind it.
- **Security**: one active one-time token (a refresh invalidates the old
  link; an accepted token cannot be reused; tokens expire). 停止 revokes
  every paired device and the current token — paired devices are cut off on
  their next request. Pairing is this plugin's access control for its own
  remote channels: `/m/api` for the phone and `/remote` for a desktop
  browser opened at a non-loopback origin. Unpaired `/remote` callers
  are refused before the request body is read. Loopback (127.0.0.1) keeps using
  `/api` directly. The default remote-desktop path does not use
  `--trusted-host`: the connection plugin's `/api` fence stays closed for
  public and LAN hosts, and the paired PC rides `/remote` instead.
  `--trusted-host` is a different SDK usage that trusts that host for `/api`
  itself — pairing does not gate `/api` (no plugin can; the fence is the
  SDK's own seam). The posture probe below reports that stance when `/api`
  is reachable without pairing.
- **Remote desktop channel**: with `requirePairingForLan` on (default), a
  desktop Web GUI opened at the LAN URL or through the tunnel transparently
  rides `/remote` — the same UI, gated by the same pairing cookie. Browser
  requests under `/api`, `/sidebar`, `/git`, and `/pet`, including the known
  event, terminal, and SSH WebSockets, are re-issued to the local web server
  without forwarding the remote Origin or pairing cookie; the authenticated
  proxy supplies its own same-origin browser marker for sibling route fences. The
  SDK's loopback-only privileged methods (native dialogs, the settings and
  credentials plane) stay unreachable from a paired remote desktop, and the
  `/api/pair/*`, `/api/update/*`, `/api/plugin-manager/*`,
  `/api/dsh-desktop-launcher/*` and `/api/dsh-web-ui-settings/*` control
  endpoints stay loopback-only. Unpaired desktop browsers get a persistent
  full-page block instead of data (the page keys off the `unpaired` error
  code, not every 403). The block retires once a gated call succeeds or the
  channel itself is torn down — turning `requirePairingForLan` off (or the
  plugin off) also clears a notice raised while the channel was briefly
  active.
- **Posture probe**: the plugin probes the SDK `/api` fence with forged
  Host headers (the public base and every LAN base). A 403 is the default
  stance (fence closed; remote access goes through pairing). Anything other
  than a 403 — `--trusted-host`, or the SDK's LAN auto-trust under
  `--host 0.0.0.0` — is surfaced as a CRITICAL log line and a red banner on
  the pairing panel, so the SDK `/api` trust stance is visible rather than
  assumed. A failed probe round drops the in-flight target key so the same
  origins are retried.
- **Live status**: the desktop panel mirrors the pairing state in real time
  (waiting → connected → disconnected) over an SSE stream, including the
  authorized-device list.
- **Remote update**: the download trigger in the sidebar foot (left of the
  phone icon) performs a silent status probe after the sidebar loads. When a
  newer registry release is available, the trigger shows a dot and the "New
  version available. Check for updates" tooltip. Clicking the trigger opens the
  update panel, which probes the npm registry for the installed
  `@linxin666/dsh-*` family releases. Without the aggregate package, checks and
  updates cover every registry-managed direct `@linxin666/*` dependency in the
  profile; local link/file development dependencies are skipped. When a newer
  release exists, the panel shows the version comparison and waits for
  confirmation — clicking "Update now" runs the update (`pnpm update --latest` inside the
  owning dsh profile; when pnpm is missing it falls back to `corepack pnpm`
  and then `npx --yes pnpm`, and on Windows the command runs through
  `cmd.exe` so npm-installed `.cmd` shims resolve; the loopback-only
  `/api/update/status` + `/api/update/run` endpoints drive it) and asks for
  a dsh web restart to pick it up. After a green pnpm exit the installed
  versions are re-checked against the registry: a green exit that left every
  version in place (e.g. the pnpm `minimumReleaseAge` gate silently skipping
  same-day releases) is reported as a stale update with configuration
  guidance instead of a false success. When the anchor itself is a local link
  install (development mode), it reports the npm state without updating.

## Screenshots

The phone surface on a 390pt viewport. Light is the default theme; a
sun/moon toggle in every header flips to the dark palette at any time.

- **Workspaces** — the roster, each row a workspace with its own sessions:
  ![Workspaces](docs/screenshots/mobile-workspaces.png)
- **Sessions** — one workspace's sessions, headed by the 新建会话 button
  (creates a blank session attached to the workspace and opens it
  immediately):
  ![Sessions](docs/screenshots/mobile-sessions.png)
- **Chat** — messages with the desktop fold discipline (collapsed
  深度思考 reasoning and 工具 tool-call rows), a pinned composer with
  模型 / 权限 chips, and a live stream while the agent works:
  ![Chat](docs/screenshots/mobile-chat.png)
- **Model picker** — the bottom sheet with a provider-grouped catalog and a
  思考强度 section per model (the same `session.models` directory the
  desktop uses):
  ![Model sheet](docs/screenshots/mobile-model-sheet.png)

## Requirements

- A DSH installation whose `dsh` CLI supports profiles (`dsh --profile`,
  `dsh plugin`) — the profile/bundle mechanism this package rides on.
- For LAN use the server must be reachable from the phone: start with
  `dsh web --host 0.0.0.0`. With the default `127.0.0.1` bind the panel
  shows an explicit explanation instead of a dead QR code — unless a public
  base URL is configured (see "Remote access over the internet" below),
  which makes the QR reachable from anywhere without rebinding. The panel's
  mint/stop endpoints are loopback-only by design: a desktop browser
  opened at the LAN URL sees a "配对面板仅限本机使用" banner instead —
  open the panel at `http://127.0.0.1` and let the phone use the paired
  link.
- For the one-click public tunnel (`autoTunnel`), the `cloudflared`
  platform binary ships with the package (its postinstall downloads it; a
  runtime download covers installers that skip postinstall scripts). No
  user-side tooling, account, or domain is needed — a Cloudflare quick
  tunnel is free and anonymous.
- Installing `/m/` as a PWA requires a secure context: `localhost` and `127.0.0.1` work for local use, while phone installation requires HTTPS. Plain LAN HTTP keeps the online mobile remote usable but cannot register its Service Worker.

## Install

Install the family aggregate package `@linxin666/dsh-web-ui-all` (all plugins and skins in one) or this plugin alone:

```sh
# Recommended: install directly from npm
dsh plugin --profile web add @linxin666/dsh-remote-web-ui@latest

# Or from the repository (development loop)
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-remote-web-ui

```

Restart the profile (`dsh web`), then open the phone icon in the sidebar
foot. The plugin's `cordis.patch.yml` inserts the single plugin row that
mounts both halves.

> `github:<org>/<repo>` installs work for a standalone repo whose package
> sits at the root (the `prepare` script builds `lib/` during install;
> pnpm ≥10 blocks that until you copy the printed key into the profile's
> `pnpm-workspace.yaml` `allowBuilds` and re-run). Monorepo subpackages
> use the `link:` form above.

## Use

1. `dsh web --host 0.0.0.0` (the printed LAN URL confirms reachability).
2. Click the phone icon → the panel mints a fresh one-time QR.
3. Scan with the phone (or open the copied link): the phone binds and
   lands on the **standalone mobile surface at `/m/`** — no desktop UI on a
   small screen. The surface is deliberately thin:
   - workspaces straight away (each workspace's session list offers an Agent
     mode picker before 新建会话: it selects the usable default preset, or the
     first usable preset, and passes that roster id with the workspace id to
     the host's `session.create`; an empty or unavailable roster keeps the
     host-default creation flow),
   - one workspace's sessions load **incrementally** (20 rows per page,
     "加载更多会话" continues; never the whole list at once),
   - opening a session fetches its chat content **on demand** (history
     pages, "加载更早的消息" goes further back),
   - a live stream shows new messages as they arrive, with a prompt box
     for sending your own (**Enter sends and Shift+Enter inserts a newline
     by default**; set `mobileEnterToSend: false` to make Enter insert a
     newline and reserve sending for the 发送 button),
   - a **light-first theme**: the surface ships a light palette by default;
     a sun/moon toggle in every header flips to the dark palette and the
     choice persists across visits (localStorage),
   - messages render with the desktop fold discipline: reasoning hides
     behind a collapsed 深度思考 disclosure, tool calls behind a collapsed
     工具 row (tap to see each call's arguments), very long answers behind
     an explicit 展开全文 toggle, each row carries its time, and assistant replies render as GFM Markdown (headings / bold / italic / inline code / code blocks / lists / tables / quotes / links / images; a zero-dependency renderer escapes first and allow-lists protocols, so the mobile bundle size barely moves; KaTeX is not supported yet and will be evaluated separately), while user messages stay plain text — and
   - a composer toolbar carries the **model** picker (provider-grouped
     catalog with a 思考强度 effort section per model) and the **权限**
     picker (permission presets; 完全权限 requires an explicit confirm
     step). Both ride the host's own `session.models` /
     `session.selectModel` RPCs and the `/permission` command — the phone
     changes the same session settings the desktop would — plus a **显示**
     sheet with persistent toggles for 工具调用 (tool-call disclosures) and
     系统提示词 (injected system messages), and a 上下文 usage chip that
     shows the latest assistant answer's context-fill percentage.
 4. On a secure origin, install the `/m/` page from the browser. The installed app retains the same mobile remote capabilities; when its browser context has no paired-device cookie, paste a fresh desktop-issued pairing link into its pairing screen.
 5. **To pair a PC instead**: copy the same link and open it in a browser on
    the other computer — the desktop URL form (`/?pair=<token>`, not `/m/`).
    After the accept round trip the full Web GUI runs there over the gated
    `/remote/api` channel; unpaired PCs see the guided blocking page and no
    data. One active token pairs one device; mint a fresh QR for the
    next device.
 6. The desktop badge flips to 已连接 in real time; it falls back to
    offline/断开 when the phone leaves.
 7. 刷新二维码 invalidates the old link and issues a new one. 停止 revokes
    mobile access: paired devices 403 on their next request, including their
    live stream.

The mobile surface is fully self-contained in this plugin: the `/m` page
and its data channel (`/m/api`) are served by the plugin's own routes and
need **no harness source changes** — the phone's RPC calls ride the
plugin's `/m/api` proxy (which delegates to the host ApiProxy service and
pages `session.list` itself), so the tunneled Host never has to enter the
connection plugin's trust fence. The phone is gated by its paired-device
cookie and an explicit method allowlist (settings/credentials/host-action
domains are never reachable from the phone; model reads/writes are limited
to the advisory `session.models` / `session.selectModel` pair, agent preset
access to read-only `agentPreset.list`, creation to `session.create`
(workspace id plus an optional id from that roster — the phone never names a
working directory of its own), and the permission picker only ever sends the
mode-agnostic `/permission` command
through the already-allowlisted `session.prompt`); the live stream arrives
over Server-Sent Events on `/m/api/events.mux`. The canonical `/m/` page owns a same-scope manifest and Service Worker; its cache is limited to the static shell and an offline page, never mobile API responses, session data, or commands.

### Behavior notes

- The mobile composer sends on Enter by default (Shift+Enter inserts a
  newline). Set `mobileEnterToSend: false` in the plugin settings card (or
  the profile patch) to make plain Enter insert a newline instead; sending
  then happens only through the 发送 button. The phone reads the flag
  through its own `/m/api` preferences method when a chat opens. On
  browsers that support `field-sizing: content`, the input grows with the
  draft up to its 120px cap in either mode.
- The `/m/` worker uses network-first static-shell fallback and waits for current pages to close before an updated worker activates. It bypasses `/m/api`, `/api`, SSE, and every write request.
- Installing this plugin routes fenced non-loopback desktop traffic onto the
  gated `/remote` channel (see `requirePairingForLan` in `src/index.ts`).
  A desktop browser opened via the LAN URL or the tunnel must pair like any
  remote device — the unpaired state shows a persistent blocking page instead of
  data; loopback (127.0.0.1) is unaffected and keeps `/api`. Set
  `requirePairingForLan: false` in the profile patch to keep the desktop on
  plain `/api` (only useful with the open-LAN stance) while keeping
  tokens/status/revocation. Note the underlying `/api` route itself is the
  SDK's: on a `--host 0.0.0.0` bind the SDK auto-trusts LAN literals, so a
  LAN client bypassing the UI can still reach `/api` directly — the posture
  probe reports that stance on the panel.
- Sibling host routes outside `/api` (`/pet/*`, `/git/*`, the right-panel `/aionui-panel/*`
  family) can consult this plugin's `remoteWebUiPairing` service: a live
  paired-device cookie is an allow path, `stop()` still cuts them off, and
  the service is absent when this plugin is not installed.
- The QR link is built from the machine's non-internal IPv4 literals; a
  multi-homed host (Wi-Fi + wired, or a proxy/VPN virtual adapter) shows a
  radio picker so you can advertise the network the phone can actually
  reach. The first literal is the default. When `publicBaseUrl` is set, the
  picker adds a 公网地址 option on top — the default QR then uses the
  public base, and picking a LAN literal re-mints an in-network link.
- A configured `publicBaseUrl` satisfies the reachable-bind requirement on
  its own: `dsh web` bound to `127.0.0.1` (no `--host 0.0.0.0`) still mints
  working public QR links through the tunnel.

## Remote access over the internet (tunnels)

### One-click public tunnel (recommended)

Turn on `autoTunnel` in the plugin settings card (or set
`autoTunnel: true` in the profile patch). The plugin then runs its own
Cloudflare quick tunnel — the `cloudflared` binary ships with the package,
no install, account, or domain needed — and wires everything itself:

- the minted `https://xxx.trycloudflare.com` URL becomes the QR base, so a
  phone anywhere can pair. The panel shows the tunnel status (starting /
  running / failed with the reason), and a crash is restarted
  automatically with backoff.

The QR stays LAN-only until the tunnel reports its URL, and a tunnel
restart mints a NEW hostname — the plugin clears the old link and mints a
fresh one, so users never touch configuration. Note that a quick tunnel is
public: anyone with the URL can load the static page; the paired-device
cookie gates are the real fence (the phone's `/m/api` with its method
allowlist, the remote desktop's `/remote/api`). The connection plugin's
`/api` fence refuses the tunneled host outright — the tunneled Host never
enters the connection trust fence — so **no profile or harness
customization is required for the auto tunnel to work**. `--trusted-host`
is not part of this path: a paired PC uses `/remote/api`.

### Manual tunnels (bring your own)

The QR link is normally a LAN URL, so a phone outside the house cannot use
it. Point a tunnel at the dsh web port and tell the plugin its public
address — the QR is then built from the tunnel URL. One knob is involved;
`--trusted-host` is a separate SDK flag, not part of this pairing path:

- **`publicBaseUrl`** (plugin config, in the profile patch or the settings
  card): the public origin, e.g. `https://foo.trycloudflare.com`. The QR
  link is built from it, and `accept`/`heartbeat`/`status` accept its host.
  A paired desktop browser rides the gated `/remote/api` channel through
  the same origin, so the desktop Web GUI works from anywhere too.
  Malformed values are ignored with a warning (LAN-only behavior kept).
  Unpaired callers of `status` see only the pairing-relevant fields (phase /
  LAN bases); token expiry, device roster, and the tunnel URL require a live
  device cookie. The accept rate limit partitions its buckets by the
  client-visible `X-Forwarded-For` hop so one internet client cannot
  exhaust the shared bucket behind the tunnel.
- **`--trusted-host <tunnel-domain>`** (optional dsh web flag, not recommended
  for this plugin on security grounds): prefer device pairing so phones use
  `/m/api` and PCs use `/remote/api`. This flag makes the SDK trust the host
  for `/api` itself, so unpaired callers can reach the ungated host API;
  pairing still gates `/m/api` and `/remote/api`, but not `/api`. If it is
  set, the posture probe reports the open `/api` fence.

### Cloudflare Tunnel (quick tunnel — no account, no domain)

Install the client once (macOS: `brew install cloudflared`; other systems:
grab the `cloudflared-darwin-{arm64,amd64}` binary from the official GitHub
releases). Then:

```sh
# 1. Expose the local port (whatever dsh web is listening on):
cloudflared tunnel --url http://127.0.0.1:3080
#    prints something like: https://xxxx-xxxx-xxxx.trycloudflare.com

# 2. Start dsh web as usual. Do not add --trusted-host for the tunnel
#    domain unless you intentionally want the SDK to trust that host for
#    /api (pairing does not cover /api; remote desktop uses /remote/api).
#    Use --host 0.0.0.0 only when LAN access should stay available:
dsh web
```

Then set `publicBaseUrl: https://xxxx-xxxx-xxxx.trycloudflare.com` in the
profile patch (or the plugin settings card — it hot-reloads). Open the
phone icon at `http://127.0.0.1`, scan the QR from anywhere: the phone
binds, reloads into the mobile surface, and heartbeats keep it online. A
desktop browser opened at the same tunnel URL pairs the same way and then
runs the full Web GUI over the gated `/remote/api` channel.

Notes:

- Quick tunnels are free and need no login, but the hostname is random per
  run: every `cloudflared` restart changes it, so update `publicBaseUrl`
  with it. Cloudflare documents no uptime guarantees;
  in-flight-request concurrency is capped (HTTP 429 past it), and **Quick
  Tunnels do not forward Server-Sent Events**. `Tailscale Serve` (and
  `tailscale serve` on a single port) behaves the same way. SSE is how the
  phone receives **live messages** in real time, so over a quick tunnel or
  Tailscale Serve the mobile chat falls back to polling: the phone still
  sends and receives messages (everything else rides plain HTTP, which does
  forward), only a new message may arrive a few seconds late instead of
  instantly. The plugin polls `session.history` on a short interval once the
  SSE channel goes silent, and resumes streaming as soon as SSE works again.
  For true real-time push, point the QR at a tunnel that forwards SSE — a
  Cloudflare **named tunnel** (domain hosted on Cloudflare, see below), or a
  plain TCP port forward (LAN address, the `tailscale up` virtual-interface
  address, or a manual `ssh -L` / cloudflared TCP tunnel to the port). A
  remote desktop browser is unaffected: its event streams ride WebSocket
  upgrades, which quick tunnels forward.
- A quick tunnel is public: anyone with the URL can load the static page.
  The paired-device cookie gates are the real fence (unpaired devices get
  403 on every `/m/api` and `/remote/api` call) — keep `requirePairingForLan`
  on. `--trusted-host` is not needed for this path and opens SDK `/api`
  outside pairing.
- For a stable hostname, create a named tunnel from the Cloudflare
  dashboard (Networking → Tunnels; the domain must be hosted on Cloudflare)
  and use its hostname as `publicBaseUrl` (only). Reachability from
  mainland China is not guaranteed by Cloudflare; verify locally.
- Tailscale is an alternative for personal use that needs no plugin
  changes at all: its virtual-interface address (`100.x.y.z`) shows up in
  the QR's address picker automatically, and a phone on the same tailnet
  reaches it like a LAN host.

## Development

Work from this repository (no sibling checkout needed):

```sh
cd ~/code/dsh-web-ui
export NPM_TOKEN='<token>'   # only if private @deepseek-ai auth is still required
pnpm install
pnpm --filter @linxin666/dsh-remote-web-ui run build
pnpm --filter @linxin666/dsh-remote-web-ui test
pnpm --filter @linxin666/dsh-remote-web-ui run typecheck
```

The peer APIs come from the official NPM SDK: every `@deepseek-ai/*` package
used here is declared in devDependencies (rc.6), and TypeScript/Vitest resolve
types straight from node_modules — no DSH source checkout is required. The
consumer-side `prepare` build (`tsdown.prepare.config.ts`) transpiles without
type checking, so git installs work without any harness checkout either.

## Checks

```sh
pnpm run typecheck
pnpm test
pnpm run build
```

## Harness contract dependencies

This plugin rides three harness seams that may not exist in older checkouts:

- **`api/gate` waterfall** (packages/client/connection): the /api route and
  event WebSocket upgrades are *designed* to emit this event after the trust
  fence so plugins can enforce application-level access control. Current
  published SDK lines do NOT emit it (the listener stays mounted for
  deployments that gain the seam). Pairing for the phone and the PC therefore
  lives on this plugin's own routes (`/m/api`, `/remote/api`); the posture
  probe reports the SDK `/api` fence stance rather than assuming it.
- **`sidebar.remote` foot seat** (packages/client/ui-sidebar): the sidebar
  declares and renders the seat the phone entry occupies.
- **LAN runtime connection fixes** (host-apiproxy `mintRpcId` fallback for
  insecure-context origins; the 20260808-branch connection loop opening the
  host stream after the mux stream): without them the browser runtime cannot
  run on a plain-HTTP LAN page at all (the mobile side of this feature).

The fence helpers (`isTrustedApiRequest` / `isLoopbackHostname`) are
reimplemented locally in `src/gate.ts` / `src/routes.ts`: the 20260810
upstream moved the trust fence inside the connection plugin and stopped
exporting them, so the pairing routes carry their own copy scoped to the
literals the QR links advertise.
See the Agent Notes `api-gate-and-sidebar-remote-seat` and
`lan-runtime-connection-fixes` in the harness checkout.

## Manual E2E: LAN pairing round trip

The unit/component specs cover the route family, the gate, and the panel,
but the pairing loop involves a real browser on a non-loopback origin.
Repeat this after any change to the wire contract or the connection loop:

1. Start the server on all interfaces with a test workspace root:
   `dsh web --host 0.0.0.0 --port 3190 --workspace-root /tmp/remote-e2e`.
2. Open the **loopback** URL (`http://127.0.0.1:3190`) in a browser: the
   phone icon sits in the sidebar foot; the panel mints a QR instantly.
3. In a second tab (or a phone) open the **LAN** URL with the pair token
   (e.g. `http://192.168.1.7:3190/?pair=<token>`): the page accepts, sets
   the HttpOnly `dsh_pair` cookie, reloads, and boots the full UI — no
   console errors, and a generation round trip completes.
4. The desktop badge flips to 已连接 in real time; a LAN-origin desktop
   page instead shows the 配对面板仅限本机使用 banner and opens no status
   stream.
5. 停止 on the desktop cuts the phone off: its next `/api` request 403s
   (reconnect loops retry until a fresh QR re-pairs).

The public path is the same round trip through a tunnel (see "Remote access
over the internet"): loopback mint → phone or PC opens the public QR URL →
accept → UI. Only `publicBaseUrl` (plugin config) names the tunneled host;
`--trusted-host` is not part of this pairing flow. The desktop panel still
opens at `http://127.0.0.1`.

## Known Limitations and Deferred Work

- **Revocation is per-request**: a paired phone whose request is already in
  flight when 停止 lands completes that request; the next one 403s.
- **Paired device sessions persist by default**: device sessions (not the
  one-time QR token) are written to `$DSH_HOME/remote-web-ui-devices.json`
  (0600, temp file + atomic rename). A paired cookie still works after a
  `dsh web` restart. Refreshing the QR still mints a new token; restarting
  does not restore the current QR. An explicit 停止 (stop) or per-device
  取消配对 still revokes immediately and the revocation is persisted.
  Sessions idle for `idleExpireMs` (default 7 days, no heartbeat or gated
  request) are deleted and must pair again. Device ids are session
  credentials (the gate authorizes requests by the device id in the cookie).
  Override `devicesFile` with another absolute path when needed. Changing
  `cookieName` invalidates existing devices (expected).
- **Device roster is loopback-only**: the pairing panel lists authorized
  devices using a short name inferred from User-Agent (for example,
  `Windows · Chrome`), online/offline state, and last active time, and can
  unpair one at a time. Credential-bearing device ids and raw User-Agent
  values are not rendered. `/api/pair/status` never returns the device id
  list, even to a paired phone.
- **The desktop gate policy is public**: `/api/pair/status` exposes only the
  boolean `requirePairingForLan` policy so a remote desktop can choose the
  correct transport before its settings scope is available. This field is
  not a credential and does not expose tokens, devices, counts, or tunnel URLs.
- **Quick-tunnel hostnames change per run**: a `trycloudflare.com` URL is
  random on every `cloudflared` start, so `publicBaseUrl` must be updated
  whenever the tunnel restarts. A named tunnel (fixed hostname) avoids the
  churn and is required for a durable installed-PWA address.
- **PWA is online-first**: only the static shell and offline page are cached. The running DSH host remains required for all mobile remote capabilities; no session, API response, or command is available offline.
- **Dev HMR**: `dsh web --dev` polls every roster bundle by path, so
  rebuilding this package (its own `tsdown --watch`) hot-reloads the client
  bundle; no harness-side watcher is involved.

## Dependency rationale

`qrcode.react` (MIT, actively maintained, React 16–19 support) renders the
QR as a dependency-free SVG component — no canvas, no server-side image
generation. It is inlined into the client bundle at build time (like the
official skin/turtle-ui plugins inline their non-shared deps), so profile
installations need no extra runtime dependency beyond the dsh peer closure.
`schemastery` is the DSH-standard config schema validator.
