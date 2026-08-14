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
  <strong>The plugin and skin family for the DeepSeek Harness (DSH) Web GUI</strong><br>
  <em>Liang Shen Mode · Task board · Git graph · Right panel · Mobile remote · SSH ops · Image understanding · Whale-girl pet · Live throughput · Skin center</em>
</p>

<p align="center">

[What It Is](#what-it-is) · [Feature Plugins](#feature-plugins) · [Skins](#skins) · [Quick Start](#quick-start) · [FAQ](#faq) · [Known Limitations](#known-limitations) · [Community](#community)

</p>

## What It Is

dsh-web-ui is a set of plugins and skins for the DeepSeek Harness (DSH) Web GUI: the "Liang Shen Mode" agent preset tuned for DeepSeek V4 Pro, plus a task board, Git graph, right panel, mobile remote, SSH ops, image understanding, a whale-girl pet, live throughput and the skin center. Everything mounts into `dsh web` through the official profile mechanism, no DSH source changes. Install plugins one by one, or grab everything with the aggregate package.

![DSH Web UI main screen](docs/screenshots/13-hero-main.png)

| Capability | Stock dsh web | dsh-web-ui family |
| --- | --- | --- |
| Agent presets | Official presets (Standard / Minimal…) | Liang Shen Mode: two-phase anchoring tuned for V4 Pro |
| Task board | None | Multi-column board + cron-scheduled real runs |
| Git visualization | None | Branch lanes + commit history graph |
| File preview & changes | None | Right panel: preview / file tree / SCM |
| Mobile remote control | None | QR pairing with SSE real-time sync |
| Remote server ops | None | SSH panel: terminal / transfer / tunnels / cluster |
| Image understanding | None | `describe_image` vision tool |
| Themes & skins | Default theme | Skin center with 10 skins, try-on before apply |

## Feature Plugins

### Liang Shen Mode

DeepSeek V4 Pro cares a lot about the tool catalog it sees on the first turn. In community benchmarks the official Standard / PTC presets score 91 / 92 and Minimal scores 99 / 96, but Minimal only has two tools. Liang Shen Mode puts the two halves together: pick it in the preset selector when you start a new session. The first turn runs Minimal-style (only a persistent `bash` and `str_replace_editor`, only your own messages), and once the trajectory is anchored it switches to Code Mode (PTC), with the full tool registry, workspace instructions and skill directory restored afterwards. Windows-native testing on DeepSeek V4 Pro: 98 / 99, average 98.5. Not luck of the draw, and no need to give up the full tool set.

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

### Right Panel

When a project session is open, two panels appear to the right of the chat area: "Preview" and "Files/Changes".

- **File tree**: browse the working directory; click a file to open it in the preview panel, click a folder row to expand, search by file name;
- **Preview**: multi-tab preview for markdown, HTML, code, diff, CSV, PDF, Office, images and text, with source / preview switching, split editing and saving;
- **Changes (SCM)**: a real git changes panel with stage / unstage / discard;
- Panel widths drag (double-click the handle to reset); collapsed state and widths persist per project;
- All ten skins cover the right panel, so it follows the theme when you switch.

![Right panel](docs/screenshots/19-right-panel.png)

### Whale-Girl Pet

A whale girl lives at the edge of the UI and changes animation with the agent's state: thinking, waiting, working, celebrating. Click her to interact (head pats), feed dried fish to raise affinity, and grow her from a baby whale to "deep-sea bond". Rename her, drag her anywhere, or hide her whenever you want.

| Working companion | Interaction panel |
| --- | --- |
| ![Whale pet](docs/screenshots/11-pet-new-chat.png) | ![Pet interaction panel](docs/screenshots/12-pet-panel.png) |

### Live Throughput Stats

The session status line already shows token usage; this plugin adds live throughput. While a response streams, input / output token totals update as estimates (`~` marks heuristics), with the TPS group after the step counter. Once provider usage arrives, the estimates get replaced with real numbers.

![Live throughput stats](docs/screenshots/18-live-stats.png)

### Mobile Remote Control

The phone icon at the bottom of the sidebar opens the pairing panel. Scan the QR code (or copy the link) and the phone lands on a standalone mobile surface for the current dsh web workspace: browse and create sessions, send and receive messages, switch models and reasoning effort, adjust the permission preset, all in sync with the desktop. Pairing tokens are one-time and time-limited; "Stop" revokes every device at any time. The QR targets the LAN by default; turn on the cloudflared public tunnel and the phone can pair from any network.

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

### Settings Hub

All family plugins' toggles and parameters live under "Settings" and apply immediately. The settings sidebar lists General, Models, Plugins and Agent presets plus the Web UI Plugins group (hosting task-board / live-stats / remote-web-ui / describe-image), Skin Center, Community Plugins and Pet as first-level entries that open directly expanded; the plugin configuration page keeps the three built-in cards (Shell / Agent loop / Web search), each with its own toggle and configuration.

![Settings hub](docs/screenshots/02-settings-web-ui-plugins.png)

## Skins

The skin center has ten skins, each with try-on before apply: the preview applies instantly and reverts fully on exit; apply with one click once you are happy.

![Skin center](docs/screenshots/03-settings-skin-center.png)

All ten skins at a glance (screenshots for Dragon Heir / Miku / THS are pending):

![All 10 skins](docs/images/skins-montage.png)

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

## Quick Start

### System Requirements

- DeepSeek Harness installed, with `dsh web` starting normally.
- npm installs need nothing extra; repository installs need Node.js >= 22 and pnpm.

### Get Started in 3 Steps

1. Install the aggregate package: `dsh plugin --profile web add @linxin666/dsh-web-ui-all`
2. Restart `dsh web`, every plugin entry appears in the sidebar
3. Open "Settings > Plugin config" to toggle plugins, or try on skins in the skin center

### Install from npm (Recommended)

The plugins are on npm (the `@linxin666` scope). One command installs everything:

```sh
dsh plugin --profile web add @linxin666/dsh-web-ui-all
```

Restart `dsh web` and all plugin entries appear in the sidebar. Skins only? Install `@linxin666/dsh-skins`.

> **Ended up with an old version?** pnpm 11+ gates brand-new releases (~10 days) via the `minimumReleaseAge` setting and silently installs an older version instead of the latest (e.g. `0.1.6` instead of `0.1.10`). Old skin-center versions lack the "bundled-carrier skin entry" fix, so applying a skin then restarting dies with `ERR_MODULE_NOT_FOUND .../dsh-client-ui-skin-<id>/index.js`. Fix: set `minimumReleaseAge: 0` in the profile's `pnpm-workspace.yaml` (or add `@linxin666/*` to `minimumReleaseAgeExclude`), then run `dsh plugin --profile web update @linxin666/dsh-web-ui-all` to reach the latest. See [issue #71](https://github.com/zhu1090093659/dsh-web-ui/issues/71).

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

> Skins only? Run only link-profile in step 3, then install `packages/dsh-skins`.
>
> Note: the profile directory is not a pnpm workspace, so `workspace:*` dependencies in the aggregate package
> fall back to the published npm versions; if the npm versions lag or break you may see "host mounted but UI
> missing". In that case run `node scripts/link-profile.mjs` first so every child package uses the
> repository build output.

### Install a Single Plugin

Prefer individual plugins? Install them one by one (published on npm, so use the package name directly):

```sh
dsh plugin --profile web add @linxin666/dsh-liangshen              # Liang Shen Mode
dsh plugin --profile web add @linxin666/dsh-client-ui-task-board   # Task board
dsh plugin --profile web add @linxin666/dsh-ssh                    # Remote connection (SSH)
dsh plugin --profile web add @linxin666/dsh-tool-describe-image    # Image understanding tool
dsh plugin --profile web add @linxin666/dsh-pet                    # Whale-girl pet
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

> **pnpm 11 release-age gate**: for about 10 days after a new release, pnpm 11's `minimumReleaseAge` gate can silently resolve to older `@linxin666/*` versions (e.g. `dsh-web-ui-all@0.1.5` with the old skin center). The old skin center writes references to standalone skin packages when a skin is applied, which crashes `dsh web` at boot (`ERR_MODULE_NOT_FOUND ... dsh-client-ui-skin-*`). Exclude every `@linxin666/*` package in the profile's `pnpm-workspace.yaml` before installing or updating:
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

A: Scheduling happens in the browser, so the `dsh web` tab has to stay open; triggers missed while it is closed are skipped, not queued. A task that is already running at the trigger time is also deferred to the next matching point.

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

A: Install `@linxin666/dsh-skins` for skins only, or use the package names under "Install a Single Plugin". Both work with the npm install flow.

</details>

## Known Limitations

- Task-board scheduling is browser-side: the `dsh web` tab has to stay open, and triggers missed while it is closed are skipped, not queued. See [dsh-task-board README](packages/dsh-task-board/README.md).
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
| dsh-task-board / dsh-git-graph / dsh-aionui-panel / dsh-pet / dsh-remote-web-ui / dsh-live-stats / dsh-web-ui-settings / dsh-liangshen / dsh-skins / dsh-web-ui-all / skins | Authored by zhu1090093659 | Apache-2.0 (zhu1090093659) |
| dsh-tool-describe-image | Ported from [whitelonng/dsh-plugin-describe-image](https://github.com/whitelonng/dsh-plugin-describe-image) (deepseek-harness `packages/vision/tool-describe-image`) | Apache-2.0 (zhu1090093659) |

## Contributors

<p align="center">
  <a href="https://github.com/zhu1090093659/dsh-web-ui/graphs/contributors">
    <img src="https://contrib.rocks/image?repo=zhu1090093659/dsh-web-ui" alt="Contributors">
  </a>
</p>

<div align="center">

**If you like it, give us a star.**

[Report Bug](https://github.com/zhu1090093659/dsh-web-ui/issues) · [Request Feature](https://github.com/zhu1090093659/dsh-web-ui/issues) · [View Releases](https://github.com/zhu1090093659/dsh-web-ui/releases)

</div>
