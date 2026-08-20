# dsh-web-ui · DSH Web UI

[中文](README.md) | English

<p align="center">
  <img src="docs/dsh-web-ui-banner.png" alt="dsh-web-ui" width="100%">
</p>

<p align="center">
  <img src="https://img.shields.io/github/v/release/zhu1090093659/dsh-web-ui?style=flat-square" alt="Version">
  &nbsp;
  <img src="https://img.shields.io/github/stars/zhu1090093659/dsh-web-ui?style=flat-square" alt="Stars">
  &nbsp;
  <img src="https://img.shields.io/github/forks/zhu1090093659/dsh-web-ui?style=flat-square" alt="Forks">
  &nbsp;
  <img src="https://img.shields.io/npm/v/@linxin666%2Fdsh-web-ui-all?style=flat-square&label=npm" alt="npm">
  &nbsp;
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License">
  <br>
  <img src="https://github.com/zhu1090093659/dsh-web-ui/actions/workflows/ci.yml/badge.svg?style=flat-square&branch=main" alt="CI">
  &nbsp;
  <img src="https://img.shields.io/badge/coverage-pending-lightgrey?style=flat-square" alt="Coverage">
</p>

CI gates: typecheck / test / scripts / docs / aggregate and gallery consistency. Coverage and code-style (Prettier / ESLint) gates are planned for CI.

<p align="center">
  <strong>The plugin and skin family for the DeepSeek Harness (DSH) Web GUI · Everything is development, everything is a plugin</strong><br>
  <em>Liang Shen Mode · Task board · Git graph · Right panel · Mobile remote · SSH ops · Image understanding · Whale-girl pet · Skin center</em>
</p>

<div align="center">

[What It Is](#what-it-is) · [Feature Plugins](#feature-plugins) · [Skins](#skins) · [Quick Start](#quick-start) · [FAQ](#faq) · [Known Limitations](#known-limitations) · [Community](#community)

</div>

## What It Is

dsh-web-ui inherits the core philosophy of DeepSeek Harness (DSH) — "everything is development, everything is a plugin" — and is its most complete realization on the Web GUI: not just a plugin package, but a plugin ecosystem with extreme extensibility. The "Liang Shen Mode" agent preset tuned for DeepSeek V4 Pro, plus a task board, Git graph, right panel, mobile remote, SSH ops, image understanding, a whale-girl pet and the skin center — each ships as an independent, self-contained module: pluggable, swappable, re-developable. Install the whole family to assemble a complete workbench, or pick one or two and they melt quietly into the stock UI. Everything mounts into `dsh web` through the official profile mechanism, no DSH source changes; the aggregate package can even bolt on external plugins like `dsh-better-sidebar` — see the [dsh-web-ui-all README](packages/dsh-web-ui-all/README.md).

"Everything is a plugin" now extends to the skins themselves: after the v2 skin-center refactor, a skin is no longer an npm package coupled to the official DSH — it is a pure asset directory (a skin.json manifest plus styles, art and optional effect scripts) loaded on demand by the skin center, the single loader. Skins are fully decoupled from the official core and coupled only to the skin center: official upgrades no longer touch any skin, and adding a skin means dropping in a directory — no publish, no install. Plugins own the logic, skins own the look; the boundary is finally clean.

![DSH Web UI main screen](docs/screenshots/13-hero-main.png)

| Capability | Stock dsh web | dsh-web-ui family |
| --- | --- | --- |
| Agent presets | Official presets (Standard / Minimal…) | Liang Shen Mode: two-phase anchoring tuned for V4 Pro |
| Task board | None | Multi-column board + cron-scheduled real runs |
| Git visualization | None | Branch lanes + commit history graph |
| File preview & changes | None | Right panel: better-sidebar (explorer / editor / terminal / git / browser); the legacy aionui panel is no longer supported (off by default; the settings card can switch back temporarily) |
| Mobile remote control | None | QR pairing with SSE real-time sync; the same link also pairs a PC browser to run the full Web GUI remotely |
| Remote server ops | None | SSH panel: terminal / transfer / tunnels / cluster |
| Image understanding | None | `describe_image` vision tool |
| Themes & skins | Default theme | Skin center with 11 skins, try-on before apply |

## Feature Plugins

### Liang Shen Mode

DeepSeek V4 Pro cares a lot about the tool catalog it sees on the first turn. In community benchmarks the official Standard / PTC presets score 91 / 92 and Minimal scores 99 / 96, but Minimal only has two tools. Liang Shen Mode puts the two halves together: pick it in the preset selector when you start a new session. The first turn runs Minimal-style (only a persistent `bash` and `str_replace_editor`, only your own messages), and once the trajectory is anchored it switches to PTC Mode, with the full tool registry, workspace instructions and skill directory restored afterwards. Windows-native testing on DeepSeek V4 Pro: 98 / 99, average 98.5. Not luck of the draw, and no need to give up the full tool set.

![Liang Shen Mode two-phase anchoring comparison (schematic, simulated render)](docs/images/liangshen-mode.png)

The mechanics, stabilization controls and limits live in [dsh-liangshen README](packages/dsh-liangshen/README.md).

### Task Board

Open it from the sidebar. Tasks sit in five columns: Planned, To-do, In Progress, Done, Failed. Click "Run" on a card and the task goes to a real DSH agent session; the card status updates itself when it finishes. Want to see what happened? Jump back into the execution session for the full transcript.

Tasks can also run on schedule: set a cron expression in the detail view (auto-upgrade DSH at 23:00 every day, weekly report at 09:00 every Monday) and it starts on its own. No babysitting.

| Multi-column board | Scheduled execution |
| --- | --- |
| ![Task board](docs/screenshots/09-task-board.png) | ![Scheduled task detail](docs/screenshots/10-task-board-detail-cron.png) |

### Git Graph

The branch picker above the input box switches branches and browses commit history. The Git graph draws branch lanes and commits on a timeline, which stays readable even in big repositories.

![Git graph](docs/screenshots/04-git-graph.png)

### Mobile Remote Control

The phone icon at the bottom of the sidebar opens the pairing panel. Scan the QR code (or copy the link) and the phone lands on a standalone mobile surface for the current dsh web workspace: browse and create sessions, send and receive messages, switch models and reasoning effort, adjust the permission preset, all in sync with the desktop. The same pairing link also pairs a **PC browser** (the phone pairing flow extended to the desktop Web GUI): open the desktop-URL form of the link on another computer and the full Web GUI runs there, its traffic on the pairing-gated `/remote/api` channel — unpaired devices get a banner and no data. Pairing tokens are one-time and time-limited; "Stop" revokes every device at any time. The QR targets the LAN by default; turn on the cloudflared public tunnel and the phone (and PC) can pair from any network. PC remote desktop should prefer this plugin's device-pairing channel; setting `--trusted-host` for a tunnel domain is not recommended on security grounds because that flag lets the SDK's `/api` bypass the pairing gate (see the [plugin README](packages/dsh-remote-web-ui/README.md)).

> **Real-time messages and tunnels**: mobile relies on SSE (Server-Sent Events) for live messages. Cloudflare quick tunnels (trycloudflare.com) and Tailscale Serve do not pass SSE through: plain HTTP works, live push never arrives. On those networks the plugin falls back to polling, so messages still flow and only new ones may lag a few seconds. For instant push use an SSE-capable tunnel (Cloudflare named tunnel, custom TCP port forwarding, etc.).

| Workspaces | Sessions & new session |
| --- | --- |
| ![Mobile workspaces](docs/screenshots/20-mobile-workspaces.png) | ![Mobile sessions](docs/screenshots/21-mobile-sessions.png) |
| Chat (folded reasoning & tool calls) | Model & reasoning-effort picker |
| ![Mobile chat](docs/screenshots/22-mobile-chat.png) | ![Model picker](docs/screenshots/23-mobile-model-sheet.png) |

### Remote Connection

The "SSH" sidebar entry opens the remote-ops panel. Hosts support key / password auth and one-click import from `~/.ssh/config`; config lives in `~/.dsh/dsh-ssh.json`. Real operations on configured hosts:

- **Web terminal**: xterm.js PTY with live output and auto-fit;
- **File transfer**: SFTP upload / download with progress and a remote directory browser;
- **Port forwarding**: local tunnels into remote internal services (databases, APIs, admin consoles), bound to 127.0.0.1 only;
- **Cluster runs**: one command across many hosts, filtered by alias / environment / tags;
- **Agent direct control**: agents share the same host config. Say "check xxx" in chat and the agent runs the remote command.

### Image Understanding

Gives text-only models vision. When a conversation mentions an image (local path, http(s) URL, or session attachment), `describe_image` sends it to a configured OpenAI-compatible vision endpoint (Qwen-VL, GLM-4V, GPT-4o, a local Ollama endpoint, whatever you have) and returns the answer. **Only the returned text enters the conversation; the image itself never enters the session log.** Text-only models have no image entry in the input box, so the plugin adds an image button: pick a file, an attachment reference lands in your draft, and the model can analyze it via `describe_image`. A `prompt` argument takes custom instructions (OCR, UI diagnosis, translation) that beat the generic description. Endpoint, model, key and default instruction live under Settings > Plugin config > "Image understanding", applied immediately.

### Right Panel

The right panel is provided by the external plugin [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) (integrated into the aggregate bundle and enabled by default), with its built-in features and third-party plugin registration — see its [README](https://github.com/omdsh-dev/DSH-better-sidebar).

![Right panel](docs/screenshots/19-right-panel.png)

> The previous aionui-panel right panel is **no longer supported**: it is off by default, receives no maintenance, tests, or fixes, and will be removed from the family bundle in a future release; Settings → Web UI Plugins → Side Card edits its everyday settings inline.

### Whale-Girl Pet

A whale girl lives at the edge of the UI and changes animation with the agent's state: thinking, waiting, working, celebrating. Click her to interact (head pats), feed dried fish to raise affinity, and grow her from a baby whale to "deep-sea bond". Rename her, drag her anywhere, or hide her whenever you want.

| Working companion | Interaction panel |
| --- | --- |
| ![Whale pet](docs/screenshots/11-pet-new-chat.png) | ![Pet interaction panel](docs/screenshots/12-pet-panel.png) |

## Skins

The skin center has eleven skins, each with try-on before apply: the preview applies instantly and reverts fully on exit; apply with one click once you are happy.

![Skin center](docs/screenshots/03-settings-skin-center.png)

All 12 skins at a glance; Maid Atelier has its own preview below:

![All 12 skins](docs/images/skins-montage.png)

### Windows XP (Luna)

A faithful recreation of the classic Luna interface: blue gradient window chrome, a green Start button, the Bliss blue-sky desktop, and square corners throughout.

![Windows XP skin](docs/screenshots/16-skin-xp-light.png)

### Blue Fantasy

Whale artwork sits beneath translucent panes in a periwinkle-indigo palette. It reads best in dark mode.

![Blue Fantasy dark](docs/screenshots/17-skin-blue-fantasy-dark.png)

### Whale Song

The deep-sea whale-goddess theme: a text-free ambience painting (a blue-haired goddess with a whale pod on the left, an ice-blue constellation grid with gold-thread accents, and generous open water on the right) sits beneath translucent panes, wrapped in an ice-blue / cyan / navy / cobalt palette, with a night-cruise dark variant.

![Whale Song light](docs/screenshots/24-skin-whale-song-light.png) · ![Whale Song dark](docs/screenshots/25-skin-whale-song-dark.png)

### Harbor

A dusk-harbor theme: the anime-girl harbor painting (a twilight-blue sky melting into sunset orange) sits beneath translucent panes, wrapped in a deep-navy base with amber-orange accents, a thin twilight scrim in light mode and a deeper dusk veil in dark mode.

![Harbor light](docs/screenshots/26-skin-harbor-light.png) · ![Harbor dark](docs/screenshots/27-skin-harbor-dark.png)

### Maid Atelier

An ornate navy workshop skin with two character layers and responsive sidebar decoration. This skin is licensed separately under CC BY-NC-SA 4.0 and is restricted to non-commercial use.

![Maid Atelier light](packages/skins/skin-center/skins/maid-atelier/preview/light.png) · ![Maid Atelier dark](packages/skins/skin-center/skins/maid-atelier/preview/dark.png)

### Wallpaper Engine Wallpapers

The skin center can use your local Wallpaper Engine library as the GUI backdrop, with support for importing dynamic and static wallpapers: video and web wallpapers render dynamically, scene wallpapers as a static frame, and any type can be pinned to a zero-animation "static frame" image. Import a single wallpaper into `skin-center/wallpapers/` to keep it working outside the Steam library, with update detection against the workshop original; without a Wallpaper Engine install (e.g. macOS), manual folders can add any `.mp4`/`.webm` folder or wallpaper project folder as the library. Wallpapers are your own local files and are never uploaded or redistributed.

![Wallpaper Engine wallpapers](docs/screenshots/29-skin-wallpaper-engine.png)

## Quick Start

### System Requirements

- DeepSeek Harness installed, with `dsh web` starting normally.
- npm installs need nothing extra; repository installs need Node.js >= 22 and pnpm.

### Get Started in 3 Steps

1. Install the aggregate package: `dsh plugin --profile web add @linxin666/dsh-web-ui-all@latest`
2. Restart `dsh web`, every plugin entry appears in the sidebar
3. Open "Settings > Plugin config" to toggle plugins, or try on skins in the skin center

### Install from npm (Recommended)

The plugins are on npm (the `@linxin666` scope). One command installs everything:

```sh
dsh plugin --profile web add @linxin666/dsh-web-ui-all@latest
```

Restart `dsh web` and all plugin entries appear in the sidebar. Skins only? Install `@linxin666/dsh-client-ui-skin-center`.

> **Ended up with an old version?** pnpm 11+ gates brand-new releases via the built-in `minimumReleaseAge` (24 hours by default) and silently installs the previous version instead of the latest (e.g. `0.1.20` instead of `0.2.0`); an explicit `@latest` is gated the same way. Old skin-center versions lack the "bundled-carrier skin entry" fix, so applying a skin then restarting dies with `ERR_MODULE_NOT_FOUND .../dsh-client-ui-skin-<id>/index.js`. Fix: set `minimumReleaseAge: 0` in the profile's `pnpm-workspace.yaml` (or add `@linxin666/*` to `minimumReleaseAgeExclude`), then run `dsh plugin --profile web update @linxin666/dsh-web-ui-all@latest` to reach the latest. See [issue #71](https://github.com/zhu1090093659/dsh-web-ui/issues/71).

### Install from the GitHub Repository (Development)

The packages are already on npm; installing from this repository is only for development (requires Node.js >= 22 and pnpm):

```sh
# 1. Clone the repository
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui

# 2. Install dependencies and build
pnpm install
pnpm -r build

# 3. Link the family into the web profile (recommended: link all children first, then the aggregate)
node scripts/link-profile.mjs
dsh plugin --profile web add link:$(pwd)/packages/dsh-web-ui-all

# 4. Restart dsh web, all plugin entries appear in the sidebar
dsh web
```

> Skins only? Run only link-profile in step 3, then install `packages/skins/skin-center`.
>
> Note: the profile directory is not a pnpm workspace, so `workspace:*` dependencies in the aggregate package
> fall back to the published npm versions; if the npm versions lag or break you may see "host mounted but UI
> missing". In that case run `node scripts/link-profile.mjs` first so every child package uses the
> repository build output.

### Install a Single Plugin

Prefer individual plugins? Install them one by one (published on npm, so use the package name directly):

```sh
dsh plugin --profile web add @linxin666/dsh-liangshen@latest               # Liang Shen Mode
dsh plugin --profile web add @linxin666/dsh-client-ui-task-board@latest    # Task board
dsh plugin --profile web add @linxin666/dsh-ssh@latest                     # Remote connection (SSH)
dsh plugin --profile web add @linxin666/dsh-tool-describe-image@latest     # Image understanding tool
dsh plugin --profile web add @linxin666/dsh-pet@latest                     # Whale-girl pet
dsh plugin --profile web add dsh-better-sidebar@latest                     # Right panel (recommended; explorer/editor/terminal/git/browser)
dsh plugin --profile web add @linxin666/dsh-client-ui-aionui-panel@latest  # Legacy right panel (aionui-panel, unsupported, transitional only)
```

### Verify and Uninstall

After installing, restart `dsh web`; a working plugin shows up in the sidebar. `dsh --profile web --dump-config` also confirms the mounted config layers. If the sidebar shows nothing, you most likely forgot to restart `dsh web`.

Uninstall: `dsh plugin --profile web remove @linxin666/dsh-web-ui-all`, then restart `dsh web`.

Technical details live in [docs/plugins.md](docs/plugins.md).

### Install Troubleshooting

<details>
<summary><strong>Expand for common pnpm issues</strong></summary>

<br>

> pnpm's strict (isolated) layout only puts the aggregate package at the profile top level, so the 11 child packages referenced by the patch rows (12 insert rows) stay nested and `dsh web` fails with `Cannot find package '@linxin666/dsh-...'`. The children are declared as dependencies of this package; on a strict layout, add `nodeLinker: hoisted` (or the legacy `public-hoist-pattern: ['@linxin666/*']`) to the profile's `pnpm-workspace.yaml` and reinstall.

> First install may stop on `ERR_PNPM_IGNORED_BUILDS` (pnpm blocks dependency build scripts): copy the printed keys (`cloudflared` / `cpu-features` / `ssh2`) into the profile's `pnpm-workspace.yaml` `allowBuilds` list and re-run.

> **pnpm 11 release-age gate**: within 24 hours of a new release (the built-in `minimumReleaseAge` default), pnpm 11 can silently resolve to older `@linxin666/*` versions (e.g. `dsh-web-ui-all@0.1.20` with the old skin center); an explicit `@latest` is gated the same way. The old skin center writes references to standalone skin packages when a skin is applied, which crashes `dsh web` at boot (`ERR_MODULE_NOT_FOUND ... dsh-client-ui-skin-*`). Exclude every `@linxin666/*` package in the profile's `pnpm-workspace.yaml` before installing or updating:
>
> ```yaml
> minimumReleaseAgeExclude:
>   - '@linxin666/*'
> ```

</details>

## FAQ

<details>
<summary><strong>I restarted, but nothing appears in the sidebar?</strong></summary>

A: First make sure the plugin went into the `web` profile (the `--profile web` in the command), then check the mounted config layers with `dsh --profile web --dump-config`. Still stuck? See "Install Troubleshooting" above. A page refresh is not enough; the `dsh web` process must restart.

</details>

<details>
<summary><strong>Why didn't a scheduled task run on time?</strong></summary>

A: Scheduling runs in the `dsh web` Host and does not require a browser tab to stay open. Occurrences missed while the Host is stopped, the system is asleep, or the Host is paused for a long time are skipped rather than queued; an occurrence due while the same task is running also rolls to the next match. To allow the display to turn off while preventing idle system sleep, explicitly enable the task board's power-protection setting.

</details>

<details>
<summary><strong>The phone pairs but gets no live messages?</strong></summary>

A: Cloudflare quick tunnels and Tailscale Serve do not pass SSE through. On those networks the plugin falls back to polling: messages still flow, new ones may lag a few seconds. For instant push use an SSE-capable tunnel (Cloudflare named tunnel, custom TCP port forwarding, etc.).

</details>

<details>
<summary><strong>I tried a skin and don't like it, what now?</strong></summary>

A: Skins support try-on before apply: the preview applies instantly and reverts fully on exit, and nothing persists until you click "Apply". Feel free to experiment.

</details>

<details>
<summary><strong>I only want the skins, or just one plugin?</strong></summary>

A: Install `@linxin666/dsh-client-ui-skin-center` for skins only, or use the package names under "Install a Single Plugin". Both work with the npm install flow.

</details>

<details>
<summary><strong>Can I install a single plugin alongside the family bundle?</strong></summary>

A: Yes. The aggregate namespaces every row id with a `web-ui-` prefix (e.g. `web-ui-describe-image`), which no longer collides with the standalone plugin's own id (e.g. `describe-image`), so `dsh web` no longer fails with `duplicate loader entry id`. When the same plugin is loaded from both sources, the host half registers once (the second source is a no-op) and the browser half is deduped by package name. Keeping both sources has no benefit, so prefer one. Note that profile patch config rows written by id must use the `web-ui-` prefixed id when the plugin comes from the bundle (e.g. the remote-web-ui `autoTunnel` row becomes `web-ui-remote-web-ui`); standalone installs keep the plugin's own id.

</details>

## Known Limitations

- The task board is scheduled by the Host and continues after the browser closes; occurrences missed while the Host is stopped or the computer is asleep are skipped and not replayed. Optional power protection is off by default and prevents only idle system sleep, not lid close, manual sleep, hibernation, or shutdown. See [dsh-task-board README](packages/dsh-task-board/README.md).
- SSH passwords and passphrases are stored in plaintext in `~/.dsh/dsh-ssh.json` (mode 0600); reconnects may replay non-idempotent commands, and remote output is returned unredacted. See the security model in [dsh-ssh README](packages/dsh-ssh/README.md).
- Mobile remote relies on SSE live push: Cloudflare quick tunnels and Tailscale Serve do not pass SSE through, so the plugin falls back to polling and new messages may arrive a few seconds late.
- Repository installs require Node.js >= 22 and pnpm and are for development only; npm installs are unaffected.

## Community

The community chat is here: talk usage, report issues and discuss ideas with the developers and other users. Scan the QQ code to join "DSH Web UI 交流群":

![DSH Web UI community](docs/community-center.jpg)

You can also join the [Discord community](https://discord.gg/6v4gm9u4S), or head straight to [GitHub Issues](https://github.com/zhu1090093659/dsh-web-ui/issues) to report bugs / request features.

<details>
<summary>Friend links</summary>

- [DeepSeek Harness Desktop](https://github.com/anywhere-labs/deepseek-harness-desktop) — a modern desktop experience built for the DeepSeek Harness (DSH) ecosystem.
- [LINUX DO](https://linux.do) — a new ideal community.
- [dshfind](https://dshfind.com) — a learning and sharing community for DeepSeek Harness, aggregating paper deep-dives, a plugin marketplace and user rankings.
- [deepseek-plugin-store](https://github.com/Ericwong5021/deepseek-plugin-store) — an independent community plugin store for DeepSeek Harness: discover, install and submit verified plugins, tools and extensions.
- [dsh-data-agent](https://github.com/omdsh-dev/dsh-data-agent) — a dedicated Data Agent preset for DSH that lets AI query, update and analyze your data.
- [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) — a Claude Code style full-screen terminal plugin filling the official terminal TUI gap: pixel whale header, live status line, streamed reasoning, double-Esc rollback, context progress and a TPS gauge.
- [dsh-tianshu-tui](https://github.com/huiliyi37/dsh-tianshu-tui) — an interactive terminal UI plugin built on the official DeepSeek Harness, adding TDD and evidence gates on top.
- [dsh-genui](https://github.com/omdsh-dev/dsh-genui) — renders generative UI inline in assistant replies via the dsh-ui fence: layouts, charts, forms, Mermaid, 3D and panel docking, with component actions looping back to the model.
- [dsh-annotation](https://github.com/omdsh-dev/dsh-annotation) — select text in DSH Web, annotate it and send it along with your message; the model replies per Annotation N.

</details>

## Contributing

- Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR; attach screenshots or verification evidence for user-visible changes.
- Commit messages follow Conventional Commits (e.g. `fix(task-board): fix xxx`); emoji is banned in code, docs and commit messages alike.
- Scaffold new plugins and skins with `node scripts/dsh-plugin-new <name>` and `node scripts/dsh-skin-new`.
- Pass the gates before submitting: `pnpm typecheck && pnpm test && pnpm docs:check`. The full workflow lives in [docs/development.md](docs/development.md).

## License

This repository is licensed under [Apache-2.0](LICENSE). Third-party code merged in must keep its LICENSE and attribution; active third parties with an upstream are forked or referenced as dependencies instead of vendored.

### Sources & Licensing

| Package | Origin | License |
| --- | --- | --- |
| dsh-task-board / dsh-git-graph / dsh-aionui-panel / dsh-pet / dsh-remote-web-ui / dsh-web-ui-settings / dsh-liangshen / dsh-skins / dsh-web-ui-all / skins | Authored by zhu1090093659 | Apache-2.0 (zhu1090093659) |
| dsh-tool-describe-image | Ported from [whitelonng/dsh-plugin-describe-image](https://github.com/whitelonng/dsh-plugin-describe-image) (deepseek-harness `packages/vision/tool-describe-image`) | Apache-2.0 (zhu1090093659) |
| dsh-better-sidebar | External integrated plugin [omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) (right panel, npm dependency reference) | MIT (omdsh-dev) |

## Contributors

<!-- CONTRIBUTORS:START -->
<p align="center">
  <a href="https://github.com/zhu1090093659"><img src="https://github.com/zhu1090093659.png?size=64" width="48" height="48" alt="zhu1090093659" title="zhu1090093659" /></a>
  <a href="https://github.com/thinkmoon"><img src="https://github.com/thinkmoon.png?size=64" width="48" height="48" alt="thinkmoon" title="thinkmoon" /></a>
  <a href="https://github.com/sharkymew"><img src="https://github.com/sharkymew.png?size=64" width="48" height="48" alt="sharkymew" title="sharkymew" /></a>
  <a href="https://github.com/mkloveyy"><img src="https://github.com/mkloveyy.png?size=64" width="48" height="48" alt="mkloveyy" title="mkloveyy" /></a>
  <a href="https://github.com/stushansusu"><img src="https://github.com/stushansusu.png?size=64" width="48" height="48" alt="stushansusu" title="stushansusu" /></a>
  <a href="https://github.com/whitelonng"><img src="https://github.com/whitelonng.png?size=64" width="48" height="48" alt="whitelonng" title="whitelonng" /></a>
  <a href="https://github.com/SnowNightt"><img src="https://github.com/SnowNightt.png?size=64" width="48" height="48" alt="SnowNightt" title="SnowNightt" /></a>
  <a href="https://github.com/ch1bug"><img src="https://github.com/ch1bug.png?size=64" width="48" height="48" alt="ch1bug" title="ch1bug" /></a>
  <a href="https://github.com/Qiuner"><img src="https://github.com/Qiuner.png?size=64" width="48" height="48" alt="Qiuner" title="Qiuner" /></a>
  <a href="https://github.com/Aa728848"><img src="https://github.com/Aa728848.png?size=64" width="48" height="48" alt="Aa728848" title="Aa728848" /></a>
  <a href="https://github.com/Menghuan1918"><img src="https://github.com/Menghuan1918.png?size=64" width="48" height="48" alt="Menghuan1918" title="Menghuan1918" /></a>
  <a href="https://github.com/Nath-Vikky"><img src="https://github.com/Nath-Vikky.png?size=64" width="48" height="48" alt="Nath-Vikky" title="Nath-Vikky" /></a>
  <a href="https://github.com/wingsky-1"><img src="https://github.com/wingsky-1.png?size=64" width="48" height="48" alt="wingsky-1" title="wingsky-1" /></a>
  <a href="https://github.com/Qinling-Melon-Farmers"><img src="https://github.com/Qinling-Melon-Farmers.png?size=64" width="48" height="48" alt="Qinling-Melon-Farmers" title="Qinling-Melon-Farmers" /></a>
  <a href="https://github.com/isdoge"><img src="https://github.com/isdoge.png?size=64" width="48" height="48" alt="isdoge" title="isdoge" /></a>
  <a href="https://github.com/TiankunDai"><img src="https://github.com/TiankunDai.png?size=64" width="48" height="48" alt="TiankunDai" title="TiankunDai" /></a>
  <a href="https://github.com/EricWang1358"><img src="https://github.com/EricWang1358.png?size=64" width="48" height="48" alt="EricWang1358" title="EricWang1358" /></a>
  <a href="https://github.com/guo6x"><img src="https://github.com/guo6x.png?size=64" width="48" height="48" alt="guo6x" title="guo6x" /></a>
  <a href="https://github.com/LittleDarkZero"><img src="https://github.com/LittleDarkZero.png?size=64" width="48" height="48" alt="LittleDarkZero" title="LittleDarkZero" /></a>
  <a href="https://github.com/z953218350"><img src="https://github.com/z953218350.png?size=64" width="48" height="48" alt="z953218350" title="z953218350" /></a>
  <a href="https://github.com/spacexun2"><img src="https://github.com/spacexun2.png?size=64" width="48" height="48" alt="spacexun2" title="spacexun2" /></a>
  <a href="https://github.com/skymecode"><img src="https://github.com/skymecode.png?size=64" width="48" height="48" alt="skymecode" title="skymecode" /></a>
  <a href="https://github.com/matriox1003"><img src="https://github.com/matriox1003.png?size=64" width="48" height="48" alt="matriox1003" title="matriox1003" /></a>
  <a href="https://github.com/ads4395-prog"><img src="https://github.com/ads4395-prog.png?size=64" width="48" height="48" alt="ads4395-prog" title="ads4395-prog" /></a>
  <a href="https://github.com/Small-tailqwq"><img src="https://github.com/Small-tailqwq.png?size=64" width="48" height="48" alt="Small-tailqwq" title="Small-tailqwq" /></a>
  <a href="https://github.com/Grivn"><img src="https://github.com/Grivn.png?size=64" width="48" height="48" alt="Grivn" title="Grivn" /></a>
  <a href="https://github.com/Xeehho"><img src="https://github.com/Xeehho.png?size=64" width="48" height="48" alt="Xeehho" title="Xeehho" /></a>
  <a href="https://github.com/JsonFish"><img src="https://github.com/JsonFish.png?size=64" width="48" height="48" alt="JsonFish" title="JsonFish" /></a>
  <a href="https://github.com/Abyss-Seeker"><img src="https://github.com/Abyss-Seeker.png?size=64" width="48" height="48" alt="Abyss-Seeker" title="Abyss-Seeker" /></a>
  <a href="https://github.com/YEYUbaka"><img src="https://github.com/YEYUbaka.png?size=64" width="48" height="48" alt="YEYUbaka" title="YEYUbaka" /></a>
  <a href="https://github.com/xohmai"><img src="https://github.com/xohmai.png?size=64" width="48" height="48" alt="xohmai" title="xohmai" /></a>
  <a href="https://github.com/RevolutionLA"><img src="https://github.com/RevolutionLA.png?size=64" width="48" height="48" alt="RevolutionLA" title="RevolutionLA" /></a>
  <a href="https://github.com/Richard-Peng402"><img src="https://github.com/Richard-Peng402.png?size=64" width="48" height="48" alt="Richard-Peng402" title="Richard-Peng402" /></a>
  <a href="https://github.com/BlessedWithLuck1105"><img src="https://github.com/BlessedWithLuck1105.png?size=64" width="48" height="48" alt="BlessedWithLuck1105" title="BlessedWithLuck1105" /></a>
  <a href="https://github.com/weike-zhang"><img src="https://github.com/weike-zhang.png?size=64" width="48" height="48" alt="weike-zhang" title="weike-zhang" /></a>
  <a href="https://github.com/Zacklinkk"><img src="https://github.com/Zacklinkk.png?size=64" width="48" height="48" alt="Zacklinkk" title="Zacklinkk" /></a>
  <a href="https://github.com/YeqingTang"><img src="https://github.com/YeqingTang.png?size=64" width="48" height="48" alt="YeqingTang" title="YeqingTang" /></a>
  <a href="https://github.com/taekchef"><img src="https://github.com/taekchef.png?size=64" width="48" height="48" alt="taekchef" title="taekchef" /></a>
  <a href="https://github.com/Aik358"><img src="https://github.com/Aik358.png?size=64" width="48" height="48" alt="Aik358" title="Aik358" /></a>
  <a href="https://github.com/chemmy-11"><img src="https://github.com/chemmy-11.png?size=64" width="48" height="48" alt="chemmy-11" title="chemmy-11" /></a>
  <a href="https://github.com/Chimney"><img src="https://github.com/Chimney.png?size=64" width="48" height="48" alt="Chimney" title="Chimney" /></a>
  <a href="https://github.com/ma15803216102"><img src="https://github.com/ma15803216102.png?size=64" width="48" height="48" alt="ma15803216102" title="ma15803216102" /></a>
  <a href="https://github.com/dongwenxiu83-web"><img src="https://github.com/dongwenxiu83-web.png?size=64" width="48" height="48" alt="dongwenxiu83-web" title="dongwenxiu83-web" /></a>
  <a href="https://github.com/dickpy"><img src="https://github.com/dickpy.png?size=64" width="48" height="48" alt="dickpy" title="dickpy" /></a>
  <a href="https://github.com/wang-kaopu"><img src="https://github.com/wang-kaopu.png?size=64" width="48" height="48" alt="wang-kaopu" title="wang-kaopu" /></a>
  <a href="https://github.com/kop022"><img src="https://github.com/kop022.png?size=64" width="48" height="48" alt="kop022" title="kop022" /></a>
  <a href="https://github.com/logan0116"><img src="https://github.com/logan0116.png?size=64" width="48" height="48" alt="logan0116" title="logan0116" /></a>
  <a href="https://github.com/nicecx"><img src="https://github.com/nicecx.png?size=64" width="48" height="48" alt="nicecx" title="nicecx" /></a>
  <a href="https://github.com/lpreterite"><img src="https://github.com/lpreterite.png?size=64" width="48" height="48" alt="lpreterite" title="lpreterite" /></a>
  <a href="https://github.com/rainow"><img src="https://github.com/rainow.png?size=64" width="48" height="48" alt="rainow" title="rainow" /></a>
  <a href="https://github.com/sclass53"><img src="https://github.com/sclass53.png?size=64" width="48" height="48" alt="sclass53" title="sclass53" /></a>
  <a href="https://github.com/starryrbs"><img src="https://github.com/starryrbs.png?size=64" width="48" height="48" alt="starryrbs" title="starryrbs" /></a>
  <a href="https://github.com/suyicon"><img src="https://github.com/suyicon.png?size=64" width="48" height="48" alt="suyicon" title="suyicon" /></a>
  <a href="https://github.com/user-A100"><img src="https://github.com/user-A100.png?size=64" width="48" height="48" alt="user-A100" title="user-A100" /></a>
  <a href="https://github.com/v833"><img src="https://github.com/v833.png?size=64" width="48" height="48" alt="v833" title="v833" /></a>
  <a href="https://github.com/wsy222"><img src="https://github.com/wsy222.png?size=64" width="48" height="48" alt="wsy222" title="wsy222" /></a>
  <a href="https://github.com/wszhoho"><img src="https://github.com/wszhoho.png?size=64" width="48" height="48" alt="wszhoho" title="wszhoho" /></a>
  <a href="https://github.com/zxkk97984-creator"><img src="https://github.com/zxkk97984-creator.png?size=64" width="48" height="48" alt="zxkk97984-creator" title="zxkk97984-creator" /></a>
  <a href="https://github.com/DDDMUC"><img src="https://github.com/DDDMUC.png?size=64" width="48" height="48" alt="DDDMUC" title="DDDMUC" /></a>
  <a href="https://github.com/AngleNaris"><img src="https://github.com/AngleNaris.png?size=64" width="48" height="48" alt="AngleNaris" title="AngleNaris" /></a>
  <a href="https://github.com/JAVA-LW"><img src="https://github.com/JAVA-LW.png?size=64" width="48" height="48" alt="JAVA-LW" title="JAVA-LW" /></a>
  <a href="https://github.com/AmethystLuna"><img src="https://github.com/AmethystLuna.png?size=64" width="48" height="48" alt="AmethystLuna" title="AmethystLuna" /></a>
  <a href="https://github.com/Beverly621"><img src="https://github.com/Beverly621.png?size=64" width="48" height="48" alt="Beverly621" title="Beverly621" /></a>
  <a href="https://github.com/DamonKoy"><img src="https://github.com/DamonKoy.png?size=64" width="48" height="48" alt="DamonKoy" title="DamonKoy" /></a>
  <a href="https://github.com/DavidWanm"><img src="https://github.com/DavidWanm.png?size=64" width="48" height="48" alt="DavidWanm" title="DavidWanm" /></a>
  <a href="https://github.com/farobute"><img src="https://github.com/farobute.png?size=64" width="48" height="48" alt="farobute" title="farobute" /></a>
  <a href="https://github.com/HAN102300"><img src="https://github.com/HAN102300.png?size=64" width="48" height="48" alt="HAN102300" title="HAN102300" /></a>
  <a href="https://github.com/Izgenlre"><img src="https://github.com/Izgenlre.png?size=64" width="48" height="48" alt="Izgenlre" title="Izgenlre" /></a>
  <a href="https://github.com/JUANWANG-BUAA"><img src="https://github.com/JUANWANG-BUAA.png?size=64" width="48" height="48" alt="JUANWANG-BUAA" title="JUANWANG-BUAA" /></a>
  <a href="https://github.com/LHMQ878"><img src="https://github.com/LHMQ878.png?size=64" width="48" height="48" alt="LHMQ878" title="LHMQ878" /></a>
  <a href="https://github.com/Lem0nTea2002"><img src="https://github.com/Lem0nTea2002.png?size=64" width="48" height="48" alt="Lem0nTea2002" title="Lem0nTea2002" /></a>
  <a href="https://github.com/Moeblack"><img src="https://github.com/Moeblack.png?size=64" width="48" height="48" alt="Moeblack" title="Moeblack" /></a>
  <a href="https://github.com/PcHeN0720"><img src="https://github.com/PcHeN0720.png?size=64" width="48" height="48" alt="PcHeN0720" title="PcHeN0720" /></a>
  <a href="https://github.com/NikolaFC"><img src="https://github.com/NikolaFC.png?size=64" width="48" height="48" alt="NikolaFC" title="NikolaFC" /></a>
  <a href="https://github.com/Scotlight"><img src="https://github.com/Scotlight.png?size=64" width="48" height="48" alt="Scotlight" title="Scotlight" /></a>
  <a href="https://github.com/Signalight"><img src="https://github.com/Signalight.png?size=64" width="48" height="48" alt="Signalight" title="Signalight" /></a>
  <a href="https://github.com/Walvez"><img src="https://github.com/Walvez.png?size=64" width="48" height="48" alt="Walvez" title="Walvez" /></a>
  <a href="https://github.com/wanpan11"><img src="https://github.com/wanpan11.png?size=64" width="48" height="48" alt="wanpan11" title="wanpan11" /></a>
  <a href="https://github.com/CCMKCCMK"><img src="https://github.com/CCMKCCMK.png?size=64" width="48" height="48" alt="CCMKCCMK" title="CCMKCCMK" /></a>
  <a href="https://github.com/Wike-CHI"><img src="https://github.com/Wike-CHI.png?size=64" width="48" height="48" alt="Wike-CHI" title="Wike-CHI" /></a>
  <a href="https://github.com/WyxBUPT-22"><img src="https://github.com/WyxBUPT-22.png?size=64" width="48" height="48" alt="WyxBUPT-22" title="WyxBUPT-22" /></a>
  <a href="https://github.com/Noob-stupid"><img src="https://github.com/Noob-stupid.png?size=64" width="48" height="48" alt="Noob-stupid" title="Noob-stupid" /></a>
  <a href="https://github.com/Starfie1d1272"><img src="https://github.com/Starfie1d1272.png?size=64" width="48" height="48" alt="Starfie1d1272" title="Starfie1d1272" /></a>
  <a href="https://github.com/great-man2096"><img src="https://github.com/great-man2096.png?size=64" width="48" height="48" alt="great-man2096" title="great-man2096" /></a>
  <a href="https://github.com/cncolder"><img src="https://github.com/cncolder.png?size=64" width="48" height="48" alt="cncolder" title="cncolder" /></a>
  <a href="https://github.com/Twelveeee"><img src="https://github.com/Twelveeee.png?size=64" width="48" height="48" alt="Twelveeee" title="Twelveeee" /></a>
</p>
<p align="center">
  <sub><a href="https://github.com/zhu1090093659/dsh-web-ui/graphs/contributors">View all contributors</a></sub>
</p>
<!-- CONTRIBUTORS:END -->

<div align="center">

**If you like it, give us a star.**

[Report Bug](https://github.com/zhu1090093659/dsh-web-ui/issues) · [Request Feature](https://github.com/zhu1090093659/dsh-web-ui/issues) · [View Releases](https://github.com/zhu1090093659/dsh-web-ui/releases)

</div>
