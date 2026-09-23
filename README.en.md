# dsh-web · DeepSeek Harness Web GUI Plugins & Themes

[中文](README.md) | English

dsh-web is a modular plugin ecosystem and desktop workstation for the DeepSeek Harness (DSH) Web GUI. It equips AI coding workflows with task automation boards, cross-device mobile remote control, SSH terminal operations, visual Git commit graphs, and personalized theme skins. Users can install the complete plugin bundle into an existing `dsh web` instance via the official profile mechanism, or download DSH Desktop—a standalone application for macOS and Windows with the Node.js runtime and plugins pre-packaged.

<p align="center">
  <img src="docs/dsh-web-banner.png" alt="dsh-web — DeepSeek Harness Web GUI plugins and themes" width="100%">
</p>

<p align="center">
  <img src="https://img.shields.io/github/v/release/zhu1090093659/dsh-web?style=flat-square" alt="Version">
  &nbsp;
  <img src="https://img.shields.io/github/stars/zhu1090093659/dsh-web?style=flat-square" alt="Stars">
  &nbsp;
  <img src="https://img.shields.io/github/forks/zhu1090093659/dsh-web?style=flat-square" alt="Forks">
  &nbsp;
  <a href="https://www.npmjs.com/package/@linxin666/dsh-web-all"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fdsh-market.com%2Fapi%2Fnpm-badge%2Fversion&style=flat-square&label=npm" alt="npm"></a>
  &nbsp;
  <a href="https://www.npmjs.com/package/@linxin666/dsh-web-all"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fdsh-market.com%2Fapi%2Fnpm-badge%2Ftotal&style=flat-square" alt="downloads"></a>
  &nbsp;
  <a href="https://dshfind.com/zh/plugins/zhu1090093659/dsh-web?ref=badge"><img src="https://dshfind.com/api/badge/zhu1090093659/dsh-web?metric=downloads&amp;lang=zh" alt="dshfind"></a>
  &nbsp;
  <a href="https://dsh-market.com"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fdsh-market.com%2Fapi%2Ftelemetry%2Fbadge%2Fusers&style=flat-square&label=users" alt="users"></a>
  &nbsp;
  <a href="https://www.npmjs.com/package/@deepseek-ai/dsh"><img src="https://img.shields.io/badge/DSH-%3E%3D0.1.7--alpha.1-4c6ef5?style=flat-square&amp;labelColor=454a54" alt="DSH"></a>
  &nbsp;
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>DeepSeek Harness (DSH) Web Plugin Ecosystem · Modular Agent Workspace</strong><br>
  <em>Workshop · Task Board · Mobile Remote · SSH Ops · Git Graph · Usage Statistics</em>
</p>

<div align="center">

[What It Is](#what-it-is) · [DSH Desktop](#dsh-desktop-desktop-client) · [Workshop](#workshop-dsh-marketcom) · [Feature Plugins](#feature-plugins) · [Skins](#skins) · [Quick Start](#quick-start) · [FAQ](#faq) · [Known Limitations](#known-limitations) · [Community](#community)

</div>

## What It Is

Stock DeepSeek Harness Web delivers fundamental chat interactions and tool execution capabilities. However, production workflows often require concurrent task scheduling, persistent background runs, remote collaboration, and developer-oriented tooling.

dsh-web mounts directly into `dsh web` via official profiles without modifying DSH core source code, providing a comprehensive modular extension suite:
- **Developer Operations & Collaboration Plugins**: Long-running scheduled task boards, cross-device mobile remote control, SSH terminal operations and file transfers, Git history graphs with worktree isolation, full session archive management, model capability declarations, and a sidebar resource explorer;
- **Decoupled Visual Themes & Assets**: Functional plugins and visual assets remain strictly separated. The skin loader handles stylesheet and dynamic effect rendering, while themes and animated desktop pets can be installed on demand from the [DSH Workshop](#workshop-dsh-marketcom);
- **Bundled or Pick-and-Choose**: Install everything with one command via `@linxin666/dsh-web-all`, or install individual plugins independently. The aggregate pre-integrates every family plugin; the alpha branch bundles no external plugin such as `dsh-better-sidebar` (install it on demand) - see the [plugin bundle installation and configuration guide](packages/dsh-web-all/README.md).

![DeepSeek Harness Web GUI with the dsh-web plugin workspace](docs/screenshots/13-hero-main.png)

| Capability | Stock dsh web | dsh-web family |
| --- | --- | --- |
| Agent presets | Official presets (Standard / Minimal…) | Official and community presets |
| Custom model capabilities | None | Declare image input and reasoning efforts per model, and disable / re-enable custom providers |
| Task board | None | Multi-column board + cron-scheduled real runs |
| Mobile remote control | None | QR pairing with SSE real-time sync; the same link also pairs a PC browser |
| Remote server ops | None | SSH panel: terminal / transfer / tunnels / cluster |
| Usage statistics | None | Token usage, provider balances, plan quotas, and Token Bank |
| File preview & changes | None | Right panel: explorer / editor / terminal / git / browser |
| Git visualization | None | Branch picker + commit history graph |
| Session archive | None | Browse and filter every session, batch archive / restore / delete with automatic policies |
| Themes & skins | Default theme | Blue Fantasy bundled with skin center; others install from Workshop |

### Find the Right DSH Extension

| Goal | Entry Point |
| --- | --- |
| Run and schedule autonomous AI agent tasks | [Task board and cron execution](packages/dsh-task-board/README.md) |
| Access DSH from a mobile phone or another computer | [Mobile and PC browser remote control](packages/dsh-remote-web-ui/README.md) |
| Manage remote servers over SSH | [SSH terminal, file transfer, and tunnels](packages/dsh-ssh/README.md) |
| Customize skins and desktop pets | [Explore the DSH Workshop](https://dsh-market.com) |
| Run as a macOS or Windows desktop app | [DSH Desktop download and requirements](#dsh-desktop-desktop-client) |
| Add plugins to an existing DSH setup | [Quick start installation](#quick-start) |

## DSH Desktop (Desktop Client)

DSH Desktop packages the DeepSeek Harness Web GUI into a native desktop application for macOS and Windows. The installer bundles a dedicated Node.js runtime environment (including npm and pnpm), the dsh host, and a preconfigured web profile (official web bundle plus dsh-web plugins). You do not need to install Node or configure the dsh CLI beforehand. Installers ship with each [Release](https://github.com/zhu1090093659/dsh-web/releases) under `dsh-desktop-*` (macOS dmg/zip and Windows exe/zip).

- **Isolated Host & Dedicated Ports**: The application runs its dsh host in the 3082-3181 port range using its bundled runtime, preventing port conflicts with the stock `dsh web` (ports 3080/3081). Both instances can run concurrently with independent sessions.
- **Shared `~/.dsh` Storage**: Shares configuration, session history, and credentials with the dsh CLI. Application-seeded profiles are marked; upgrades re-seed runtime components while preserving custom user patch layers without touching user-managed profiles.
- **In-App Plugin Management**: Forwards `dsh plugin add/remove` calls directly to bundled pnpm, eliminating the need for external build tools.
- **Self-Diagnosing Startup**: If payloads are missing or the host fails to bind, the app displays a diagnostic error page showing host logs with options to retry or open the log file directly.

Installers are currently unsigned. On macOS, right-click and select "Open" on first launch to clear Gatekeeper. On Windows, click "More info" and select "Run anyway" when SmartScreen appears. See [desktop README](desktop/README.md) for build instructions, configuration, and security models.

## Workshop (dsh-market.com)

The [DSH Workshop](https://dsh-market.com) is a unified hub for themes, pets, plugins, and community Agent presets. Entries are ranked by verified device likes; themes provide live interactive previews, and plugins offer copy-ready install commands. The classic Blue Fantasy theme is bundled with the skin center plugin; additional themes and pets can be previewed, inspected, and installed on demand. In the Web GUI, the "Workshop" settings tab lets you browse the catalog directly: skins and pets install straight into the DSH home directory for immediate use, while community presets install to an inactive local library and activate under "Settings → Agent Presets".

![Workshop homepage](docs/screenshots/31-market-home.png)

The site is built directly from this repository: static pages are generated by `scripts/market-build` from authoritative manifests (`skin.json`, `pet.json`, and `community.json`), while interactive features like anonymous voting run on Cloudflare Workers edge functions with D1 persistence (one vote per device). Changes deploy automatically on push to `main`.

The Workshop provides an open, transparent space for community creators to share their work and for users to discover vetted extensions.

## Feature Plugins

### Task Board（任务看板）

Open from the "Task Board" icon in the sidebar. Tasks are organized into five columns: Backlog, Todo, In Progress, Done, and Failed. Clicking "Run" on any card dispatches the task to an autonomous DSH agent session; status updates automatically write back to the card upon completion, and you can jump straight into the execution session to review the conversation log.

Tasks also support persistent host scheduling: configure cron expressions in task details (such as running daily upgrades at 23:00 or generating weekly reports on Mondays at 09:00). Scheduled tasks execute reliably even when browser tabs are closed. An optional power-management setting prevents system idle sleep while allowing screens to power down on macOS, Windows, and Linux with systemd-logind (disabled by default).

Tasks can optionally reuse sessions: when enabled, subsequent runs continue in the previous session if it remains idle in memory (retaining conversation context while re-applying designated permissions and models); if the session has exited, a fresh session is spawned automatically.

| Multi-Column Board | Scheduled Execution |
| --- | --- |
| ![Task board](docs/screenshots/09-task-board.png) | ![Task scheduling](docs/screenshots/10-task-board-detail-cron.png) |

### Mobile Remote Control（移动端远程控制）

Click the phone icon at the bottom of the sidebar to open the pairing modal. Scan the QR code or copy the link to access the full Web GUI on your mobile browser with dedicated touch adaptations: tap the whale floating button to toggle the sidebar, swipe horizontally to show or hide panels, long-press session items for context menus, press Enter for newlines, and interact with 16px inputs configured to prevent viewport auto-zooming. Desktop-heavy panels (such as SSH terminals, task boards, and Git graphs) automatically collapse on mobile screens, leaving a focused interface for message exchange, model switching, and reasoning adjustments in sync with the desktop state.

The same pairing link works seamlessly on **secondary PC browsers**: open the desktop URL variant on another computer to launch the full Web GUI interface. All traffic passes through the authenticated `/remote/api` proxy route; unpaired devices encounter an access-denied banner. Pairing tokens are single-use and time-limited, and clicking "Stop" immediately revokes active device sessions. Communication defaults to the local network; pairing over wide-area networks is easily enabled using tunnel utilities like cloudflared. For security, route connections through the pairing gateway and avoid setting `--trusted-host` on tunnel domains, as that flag bypasses pairing checks (see [remote plugin README](packages/dsh-remote-web-ui/README.md)).

![Mobile and Web interface sync](docs/assets/phone-and-web.png)

> **Real-Time Streaming & Tunnels**: Mobile clients rely on SSE (Server-Sent Events) for token streaming. Services like Cloudflare quick tunnels (trycloudflare.com) and Tailscale Serve do not proxy SSE streams by default; under these connections, the plugin automatically falls back to short polling. Messages send and receive normally with a minor polling interval delay. For smooth real-time streaming, use tunnels supporting persistent HTTP connections (such as Cloudflare named tunnels or self-hosted TCP proxies).

| Mobile Home (Whale toggle) | Session List |
| --- | --- |
| ![Mobile Home](docs/screenshots/20-mobile-home.png) | ![Mobile Session List](docs/screenshots/21-mobile-sessions.png) |
| Chat (Thinking & Tool execution) | Model Selection Sheet |
| ![Mobile Chat](docs/screenshots/22-mobile-chat.png) | ![Model Selection Sheet](docs/screenshots/23-mobile-model-sheet.png) |

### SSH Remote Ops（远程连接）

Open the remote operations panel from the "SSH" sidebar icon. Supports key-based and password authentication, and imports existing host definitions from `~/.ssh/config` with one click; configurations persist securely in `~/.dsh/dsh-ssh.json`. Available capabilities include:

- **Web Terminal**: Full-featured interactive terminal powered by xterm.js with real-time output and responsive window resizing;
- **File Transfer**: Built-in SFTP file manager with visual upload and download progress bars and directory browsing;
- **Port Forwarding**: Local tunnels routing to remote internal services (such as databases or internal APIs), binding exclusively to 127.0.0.1;
- **Cluster Execution**: Concurrently dispatch commands across multiple servers filtered by alias, environment, or tags;
- **Agent Integration**: AI agents share host configurations with the panel; simply instruct the agent in chat to inspect remote servers and run diagnostics.

### Usage Statistics（使用统计）

Monitor token consumption, provider balances, and subscription quotas under "Settings > Usage Statistics" with automated refresh and manual query options.

- **Usage Breakdown**: Track daily input, output, and cache token metrics segmented by provider and model, alongside 30-day expenditure trends; compatible providers display real-time balances, and DeepSeek official routes estimate off-peak pricing and billing details.
- **Subscription Tracking**: Monitor percentage allowances and reset schedules for personal plans including Kimi, GLM, MiniMax, OpenCode Go, and Codex / ChatGPT.
- **Token Bank**: Automatically mint 1 Whale Yuan for every token processed via DeepSeek official routes, tracked as collectible Whale Vouchers with sharing capabilities.
- **Pet Integration**: With the desktop pet plugin installed, floating desktop companions provide conversational bubble notifications displaying current quota balances and daily consumption.

Tracking starts upon initial plugin activation without backfilling historical sessions; vouchers cover DeepSeek official usage within configured ledger retention windows. See [dsh-usage README](packages/dsh-usage/README.md) for supported providers and limitations.

![Usage Statistics Plugin: Token Bank & Whale Vouchers](docs/screenshots/35-usage-token-bank.webp)

### Model Capabilities（模型能力）

Configure model-level parameters for custom providers directly within "Settings > Models". This plugin supplies a visual editor for capabilities omitted from default cards:

- **Image Input Declarations**: Expand "Model Capabilities" within custom provider cards to explicitly declare multimodal support (`["text","image"]` or `["text"]`);
- **Reasoning Effort Profiles**: Mark non-reasoning models (hiding thinking sliders in the chat composer), inherit global defaults, or define explicit reasoning tiers with exact payload values;
- **Immediate Effect & Conflict Protection**: Changes save through official storage pathways and apply immediately without restarting the host; writes enforce revision checks to prevent overwriting concurrent updates;
- **One-Click Provider Toggling**: Temporarily disable provider routes without losing stored API keys, instantly hiding inactive models from selection pickers.

*Note: Declarations inform outgoing request payloads and do not perform automated gateway probing. If a model is declared with image support but the upstream provider gateway rejects multimodal payloads, the request will fail at the gateway level. Details in [dsh-model-capabilities README](packages/dsh-model-capabilities/README.md).*

### Right Panel（右侧面板）

The right panel is provided by community plugin [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar). It embeds a file explorer, inline code editor, auxiliary terminal, Git interface, and web browser, while allowing third-party plugin panels to dock cleanly. The alpha branch's aggregate does not bundle it (its 0.19.1 peers declare `^0.1.5-rc.1`, which this branch's 0.1.7-alpha.1 cohort does not satisfy); install it on demand with `dsh plugin --profile web add dsh-better-sidebar@latest`. Architecture and setup details are available in its [repository](https://github.com/omdsh-dev/DSH-better-sidebar).

![Right Panel](docs/screenshots/19-right-panel.png)

### Git Graph（Git 图谱）

An integrated Git toolbar and visual commit history graph positioned above the chat composer:

- **Branch & Commit Graph**: Visualizes branch forks, merge swimlanes, and commit timelines to help developers track changes and switch branches across projects.
- **Git Worktree Isolation**: When multiple agents run concurrent tasks, modifying files in the primary checkout risks branch collisions and dirty working trees. The plugin creates isolated worktrees under `$DSH_HOME/worktrees/` on dedicated branches (`wt/<name>`), leaving primary repository files untouched. An integrated management view lets developers inspect and prune temporary checkouts.
- **Automated Policies & Agent Tooling**: Enable automatic worktree allocation for new sessions entering Git workspaces, or provide the `git_worktree` tool to autonomous agents for self-directed environment management.

| Git Graph | Parallel Sessions with Git Worktree |
| --- | --- |
| ![Git Graph](docs/screenshots/04-git-graph.png) | ![Git worktree parallel sessions](docs/screenshots/34-git-worktree.png) |

### Session Archive Manager（会话归档管理）

The session archive manager (`dsh-session-archive`) provides centralized governance over growing numbers of short-lived and persistent conversation logs:

- **Centralized Search & Filtering**: Audit active, archived, blank, subagent, and orphaned historical sessions with keyword filtering across titles, workspaces, and session IDs.
- **Batch Actions with Cascade Safety**: Perform multi-select archiving, restoration, and permanent deletions. Physical deletions display affected descendant counts and estimated reclaimed disk space, requiring confirmation prompts for bulk actions; active sessions and sessions with running children remain protected against deletion.
- **Automated Retention Policies**: Two optional automated rules archive stale sessions based on last activity and prune aged archives by retention period, with dry-run previews supported before enabling.

Permanent deletions cannot be undone, and all operational routes bind strictly to the local loopback interface. See [dsh-session-archive README](packages/dsh-session-archive/README.md).

### More Plugins（更多插件）

- **Skill Explorer** (`dsh-client-ui-skill-explorer`): Inspect and manage loaded agent skills grouped by origin, featuring keyword filtering across names and descriptions, workspace scoping, and activation toggling.
- **Plugin Manager** (`dsh-client-ui-plugin-manager`): Install plugins from npm or git repositories via official host interfaces, inspect statuses, and adjust configuration settings.

### Skins

The classic Blue Fantasy theme serves as the built-in default skin: rich indigo gradients, semi-transparent frosted glass elements, and custom whale artwork provide an immersive dark-mode visual experience. Additional themes and Wallpaper Engine animated backgrounds are managed by the skin center and can be previewed, tried on, and installed through the [Workshop](https://dsh-market.com).

![Blue Fantasy Dark](docs/screenshots/17-skin-blue-fantasy-dark.png)

## Quick Start

### System Requirements

- DeepSeek Harness installed with `dsh web` functioning properly.
- npm installations have no extra requirements; building from the source repository requires Node.js >= 22 and pnpm.

### Get Started in 3 Steps (npm, Recommended)

- **DSH Web CLI (Browser Installation)**:
  1. Install the bundle: `dsh plugin --profile web add @linxin666/dsh-web-all@latest`
  2. Restart `dsh web` to display new plugin icons in the sidebar
  3. Navigate to "Settings > Plugin Configuration" to toggle individual features, or select skins from the skin panel
- **DSH Desktop (Desktop Client)**:
  1. Download the `dsh-desktop-*` installer for your operating system from [Releases](https://github.com/zhu1090093659/dsh-web/releases) (macOS dmg/zip or Windows exe/zip)
  2. Install and launch the application: the bundled runtime and complete plugin suite load immediately without prerequisite setup
  3. Manage plugins or customize themes using the integrated plugin manager or settings view

> To install only the skin engine, use `@linxin666/dsh-client-ui-skin-center`. If your package manager pins an older version due to release age restrictions, see "Install Troubleshooting" below.

### Install Directly from the GitHub Repository

The repository root includes a standard `dsh.bundle` manifest, allowing installation directly from git without cloning or manual building:

```sh
dsh plugin --profile web add github:zhu1090093659/dsh-web
# Equivalent: dsh plugin --profile web add git+https://github.com/zhu1090093659/dsh-web.git
```

This approach is equivalent to installing the npm aggregate package. Use either method, but do not install both simultaneously to prevent conflicting entry IDs.

### Install from the Repository (Development)

For plugin development and debugging, build from source using Node.js >= 22 and pnpm:

```sh
# 1. Clone the repository
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web

# 2. Install dependencies and build all packages
pnpm install
pnpm -r build

# 3. Link packages into the web profile (linking sub-packages before the aggregate is recommended)
node scripts/link-profile.mjs
dsh plugin --profile web add link:$(pwd)/packages/dsh-web-all

# 4. Restart the web server
dsh web
```

> Note: Because profile directories are not configured as pnpm workspaces, internal `workspace:*` dependencies fall back to npm versions. If published npm packages differ from local builds, run `node scripts/link-profile.mjs` first to ensure all sub-packages resolve to local build outputs.

### Upgrade from the legacy aggregate

If your profile still references `@linxin666/dsh-web-ui-all`, the plugin manager's update routine recognizes this as a migration path (`@linxin666/dsh-web-ui-all` → `@linxin666/dsh-web-all`). Clicking "Update" executes a safe transactional replacement: the legacy package is unmounted and replaced with the new aggregate while preserving bundle order, followed by configuration verification via `--dump-config` with automatic rollback upon errors.

### Install a Single Plugin

Install individual components independently if you prefer not to use the complete bundle:

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-task-board@latest              # Task Board
dsh plugin --profile web add @linxin666/dsh-ssh@latest                             # SSH Remote Ops
dsh plugin --profile web add @linxin666/dsh-usage@latest                           # Usage Statistics
dsh plugin --profile web add @linxin666/dsh-client-ui-model-capabilities@latest    # Model Capabilities
dsh plugin --profile web add @linxin666/dsh-pet@latest                             # Desktop Pet
dsh plugin --profile web add @linxin666/dsh-session-archive@latest                 # Session Archive Manager
dsh plugin --profile web add dsh-better-sidebar@latest                             # Right Panel (not bundled on the alpha branch)
```

<details>
<summary><strong>Full npm Package Directory</strong></summary>

All plugins are published under the `@linxin666/dsh-*` npm scope:

| Package Name | Description |
| --- | --- |
| [@linxin666/dsh-web-all](https://www.npmjs.com/package/@linxin666/dsh-web-all) | Aggregate bundle: complete suite of feature plugins and skin center |
| [@linxin666/dsh-client-ui-task-board](https://www.npmjs.com/package/@linxin666/dsh-client-ui-task-board) | Task board: multi-column tracking and cron scheduling |
| [@linxin666/dsh-remote-web-ui](https://www.npmjs.com/package/@linxin666/dsh-remote-web-ui) | Mobile remote control: QR pairing, cross-device sync, and touch gestures |
| [@linxin666/dsh-ssh](https://www.npmjs.com/package/@linxin666/dsh-ssh) | SSH operations: web terminal, SFTP transfers, tunnels, and cluster commands |
| [@linxin666/dsh-usage](https://www.npmjs.com/package/@linxin666/dsh-usage) | Usage statistics: token consumption, balances, plan tracking, and Token Bank |
| [@linxin666/dsh-client-ui-model-capabilities](https://www.npmjs.com/package/@linxin666/dsh-client-ui-model-capabilities) | Model capabilities: declare multimodal input and reasoning effort profiles |
| [@linxin666/dsh-pet](https://www.npmjs.com/package/@linxin666/dsh-pet) | Desktop pet: registry-driven interactive floating companions |
| [@linxin666/dsh-client-ui-git-graph](https://www.npmjs.com/package/@linxin666/dsh-client-ui-git-graph) | Git graph: visual commit logs, branch flows, and worktree isolation |
| [@linxin666/dsh-client-ui-skin-center](https://www.npmjs.com/package/@linxin666/dsh-client-ui-skin-center) | Skin center: runtime engine for themes and dynamic backgrounds |
| [@linxin666/dsh-client-ui-market](https://www.npmjs.com/package/@linxin666/dsh-client-ui-market) | Workshop client: one-click installation for skins, pets, and presets |
| [@linxin666/dsh-client-ui-preset-center](https://www.npmjs.com/package/@linxin666/dsh-client-ui-preset-center) | Preset center: community Agent preset repository management |
| [@linxin666/dsh-client-ui-plugin-manager](https://www.npmjs.com/package/@linxin666/dsh-client-ui-plugin-manager) | Plugin manager: install, toggle, and configure extensions |
| [@linxin666/dsh-client-ui-skill-explorer](https://www.npmjs.com/package/@linxin666/dsh-client-ui-skill-explorer) | Skill explorer: browse, search, and manage registered agent skills |
| [@linxin666/dsh-session-archive](https://www.npmjs.com/package/@linxin666/dsh-session-archive) | Session archive: search, batch restore, and cascade pruning |
| [@linxin666/dsh-client-ui-community-plugins](https://www.npmjs.com/package/@linxin666/dsh-client-ui-community-plugins) | Community plugin source: authoritative index powering the Workshop |
| [@linxin666/dsh-client-ui-web-ui-settings](https://www.npmjs.com/package/@linxin666/dsh-client-ui-web-ui-settings) | Preferences panel: global settings and UI configurations |

</details>

### Verify and Uninstall

Restart `dsh web` after installation; the appearance of corresponding sidebar icons indicates successful mounting. Run `dsh --profile web --dump-config` to confirm the configuration layer is loaded. If icons do not appear, verify that the service process has fully restarted.

To uninstall: run `dsh plugin --profile web remove @linxin666/dsh-web-all` and restart `dsh web`.

Architecture and mounting details are documented in [docs/plugins.md](docs/plugins.md).

### Install Troubleshooting

<details>
<summary><strong>Common Installation and Build Resolutions</strong></summary>

<br>

> **Missing Sub-package Errors under Isolated pnpm**: In strict isolated mode, pnpm may hoist only the aggregate package while placing sub-packages in nested directories, causing errors like `Cannot find package '@linxin666/dsh-...'`. Add `nodeLinker: hoisted` (or `public-hoist-pattern: ['@linxin666/*']`) to your profile's `pnpm-workspace.yaml` and reinstall.

> **Blocked Build Scripts (ERR_PNPM_IGNORED_BUILDS)**: If pnpm blocks native build scripts during initial setup, append `cloudflared`, `cpu-features`, and `ssh2` to `allowBuilds` in your profile's `pnpm-workspace.yaml`.

> **pnpm 11 Release Age Restrictions**: For newly published versions, pnpm 11's default security window (`minimumReleaseAge`) may pull older package revisions. Exclude the namespace in `pnpm-workspace.yaml` to ensure timely updates:
>
> ```yaml
> minimumReleaseAgeExclude:
>   - '@linxin666/*'
> ```

</details>

## FAQ

<details>
<summary><strong>Why do sidebar icons not show up after restarting?</strong></summary>

Verify that the package was added with the `--profile web` parameter and run `dsh --profile web --dump-config` to inspect active configuration layers. Simply refreshing the web browser is insufficient; the backend `dsh web` process must be fully restarted.

</details>

<details>
<summary><strong>Why did a scheduled task miss its execution window?</strong></summary>

Scheduling runs directly on the `dsh web` host daemon without requiring browser tabs to stay open. If the host process exits or the system enters sleep, missed triggers are skipped rather than backfilled; overlapping runs will defer to the next matching interval. Enable task board power protection to keep the machine awake during unattended schedules.

</details>

<details>
<summary><strong>Why does mobile pairing fail to stream real-time updates?</strong></summary>

Streaming relies on SSE. Cloudflare quick tunnels and Tailscale Serve do not proxy SSE connections, causing the client to fall back to short polling. For seamless token streaming, use tunnels supporting persistent connections such as Cloudflare named tunnels or self-hosted TCP reverse proxies.

</details>

<details>
<summary><strong>How do I revert a theme preview?</strong></summary>

The skin center includes zero-disk previewing: preview changes apply instantly in memory and revert upon closing the preview panel. Themes persist to disk only when you click "Apply".

</details>

<details>
<summary><strong>Can I install only the themes or a single plugin?</strong></summary>

Yes. Install `@linxin666/dsh-client-ui-skin-center` for themes alone, or install any single package using the package names in the "Install a Single Plugin" section.

</details>

<details>
<summary><strong>Can individual plugins be installed alongside the aggregate bundle?</strong></summary>

Yes. Aggregate bundle entries use the `web-ui-` ID prefix (such as `web-ui-usage`), avoiding duplicate loader ID collisions with standalone packages. The host automatically deduplicates instances. Generally, the aggregate package alone fulfills all needs.

</details>

## Known Limitations

- Task board scheduling runs on the backend host; closing browser tabs will not interrupt tasks, but stopping the host process or putting the machine to sleep will skip missed schedules without backfilling. Optional power management prevents idle sleep only and cannot bypass manual sleep, lid closure, or power shutdown (see [dsh-task-board README](packages/dsh-task-board/README.md)).
- SSH credentials (passwords and private key passphrases) persist locally in `~/.dsh/dsh-ssh.json` with 0600 permissions; reconnecting during connection drops may replay non-idempotent commands, and remote outputs return without sanitization (see [dsh-ssh README](packages/dsh-ssh/README.md)).
- Mobile streaming uses SSE: connections through proxies without SSE pass-through automatically drop back to polling with small update latencies.
- Full repository builds require Node.js >= 22 and pnpm; standard npm installations have no developer tool prerequisites.

## Community

Join the community to discuss workflows, report issues, and share ideas.

Scan the QR code to join the "DSH Web UI" QQ community:

<img src="docs/community-center.jpg" alt="DSH Web UI Community Group" width="240">

You can also join our [Discord community](https://discord.gg/6v4gm9u4S), or submit bug reports and feature requests directly via [GitHub Issues](https://github.com/zhu1090093659/dsh-web/issues).

<details>
<summary>Friendly Links</summary>

- [DeepSeek Harness Desktop](https://github.com/anywhere-labs/deepseek-harness-desktop) —— Modern desktop client tailored for the DeepSeek Harness ecosystem.
- [LINUX DO](https://linux.do) —— An earnest community for modern developers.
- [dshfind](https://dshfind.com) —— Learning and discovery hub for DSH: paper deep-dives, plugin directory, and community leaderboards.
- [deepseek-plugin-store](https://github.com/Ericwong5021/deepseek-plugin-store) —— Community plugin directory to discover, install, and share vetted tools.
- [dsh-data-agent](https://github.com/omdsh-dev/dsh-data-agent) —— Dedicated data agent presets for querying, analyzing, and transforming datasets.
- [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) —— Fullscreen terminal TUI inspired by Claude Code: status bars, streaming thought display, and TPS monitoring.
- [dsh-tianshu-tui](https://github.com/huiliyi37/dsh-tianshu-tui) —— Interactive terminal interface with built-in TDD and evidence gates.
- [dsh-genui](https://github.com/omdsh-dev/dsh-genui) —— Generative UI rendering inline cards, diagrams, 3D scenes, and forms directly within assistant replies.
- [dsh-annotation](https://github.com/omdsh-dev/dsh-annotation) —— Inline annotation plugin: select text, attach notes, and prompt models with point-by-point feedback.

</details>

## Contributing

- Review [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request; attach screenshots or evidence for user-facing modifications;
- Follow Conventional Commits (such as `fix(task-board): resolve state sync issue`); emoji usage is prohibited across code, documentation, and commit messages;
- Scaffold new plugins and skins using official scripts: `node scripts/dsh-plugin-new <name>` and `node scripts/dsh-skin-new`;
- Verify repository quality gates before submitting: `pnpm typecheck && pnpm test && pnpm docs:check`; complete development workflow in [docs/development.md](docs/development.md).

## License

Licensed under [Apache-2.0](LICENSE). Imported third-party code must retain original licenses and attributions; active third-party dependencies should be integrated via npm packages or forks rather than code copying.

### Sources & Licensing

<details>
<summary>Third-party sources & licenses (click to expand · plugins / skins / pets)</summary>

**Plugins**

- **dsh-task-board / dsh-git-graph / dsh-pet / dsh-remote-web-ui / dsh-web-settings / dsh-ssh / dsh-skill-explorer / dsh-market / dsh-plugin-manager / dsh-community-plugins / dsh-web-all** — authored by zhu1090093659, Apache-2.0 (zhu1090093659)
- **dsh-tool-describe-image** — ported from [whitelonng/dsh-plugin-describe-image](https://github.com/whitelonng/dsh-plugin-describe-image) (deepseek-harness `packages/vision/tool-describe-image`), Apache-2.0 (zhu1090093659)
- **dsh-better-sidebar** — external integrated plugin [omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) (right panel, an on-demand install on the alpha branch rather than a bundled dependency), MIT (omdsh-dev)
- **dsh-ssh** — implemented against the capability list of [badseal/ssh-skill](https://github.com/badseal/ssh-skill); code is this repository's Apache-2.0 (zhu1090093659), the upstream capability list belongs to badseal/ssh-skill
- **Community plugin index** — 37 external plugins with sources and licenses declared by their authors, registered in [community.json](packages/dsh-community-plugins/community.json), browsable in Settings → Community Plugins and on dsh-market.com

**Skins (third-party authors or artwork)**

- **maid-atelier / orca-link** — [Small-tailqwq/dsh-deep-whale](https://github.com/Small-tailqwq/dsh-deep-whale), CC BY-NC-SA 4.0; attribution chains in the in-package LICENSE/NOTICE (maid: 上善 → zipzip → Small-tailqwq; orca: 上善 → Small-tailqwq)
- **phoebe-atelier** — [Theater-ahyeon/phoebe-atelier](https://github.com/Theater-ahyeon/phoebe-atelier), CC BY-NC-SA 4.0; the character Phoebe is (c) Kuro Games (Wuthering Waves); AI-assisted fan derivative, non-commercial use only (attribution chain in the package LICENSE/NOTICE)
- **cyber-night** — logan0116; code under the repository license, backdrop generated by the author with OpenAI GPT and released as CC0 1.0 (public domain)
- **future-window** — zhuqin; original background and decorative artwork Apache-2.0 (in-package LICENSE/NOTICE, attribution in skin.json)
- **matrix** — contributor seanchen original (Matrix dark eye-care skin), Apache-2.0 (declared by seanchen)
- **blue-fantasy** — powerdog996 (DreamSkin community) adapted by dsh-web; no third-party license statement in the skin directory (pending author confirmation)
- **whalechan-harness** — Whale-chan Theme contributors from [online111111/whalechan-dsh-theme](https://github.com/online111111/whalechan-dsh-theme); character direction references [Neko3000/deepseek-whalechan](https://github.com/Neko3000/deepseek-whalechan), CC BY-NC-SA 4.0, with full attribution and unofficial-project disclaimer in the skin directory LICENSE/NOTICE
- **deep-current** — Twelveeee; no license statement in the skin directory (pending author confirmation)
- **furina** — artwork by sclass53, skin code zhu1090093659 (in-directory LICENSE is BSD-3-Clause); the Furina character belongs to miHoYo (Genshin Impact) and is used as fan art
- **harbor** — moeblack; no license statement in the skin directory (pending author confirmation)
- **miku** — artwork by 涂山苏苏, skin code zhu1090093659; the Hatsune Miku character belongs to Crypton Future Media, INC. (Piapro Character License)
- **pink-sakura** — artwork by guomengjia618-dot, skin code zhu1090093659 (in-directory LICENSE is Apache-2.0)
- **war-thunder** — skin code is this repository's (Apache-2.0); the background art and launcher crest are extracted read-only from a local War Thunder client, copyright Gaijin Entertainment, personal non-commercial use only (see skin.json attribution)
- **blue-throated-bee-eater** — skin code is this repository's (dsh-web, Apache-2.0); background photo by Kriangsak Hongchumpae (Wikimedia Commons, CC BY-SA 4.0, downscaled and re-compressed; the license and attribution chain are in the in-directory NOTICE and skin.json attribution)
- **whale-maid (Whale Girl · Sea Gaze)** — the skin engineering, both backdrop illustrations and the decorative SVG assets are original work by stushansusu, released under CC BY-NC-SA 4.0 (in-directory LICENSE, attribution in skin.json)

> The remaining skins (mint / whale-song / whale-mom / dragon-heir / minecraft / trading / summer-liquid-glass / wallpaper-exclusive / xp) are original to this repository, Apache-2.0.

**Pets**

- **ouo-neko** — Pessimist0906, MIT (contribution record in [PR #1118](https://github.com/zhu1090093659/dsh-web/pull/1118) and dsh-pet [THIRD_PARTY_NOTICES.md](packages/dsh-pet/THIRD_PARTY_NOTICES.md))
- **whale / whale-refined** — whale ornaments derived from the DeepSeek wordmark (MIT / BSD-3-Clause; materials and statements in dsh-pet THIRD_PARTY_NOTICES.md)
- **miku** — artwork by stushansusu (涂山苏苏), MIT; the "Hatsune Miku" name, likeness and portrait rights belong to Crypton Future Media, INC. (Piapro Character License)
- **jyn (女仆鲸鱼娘)** — 11726, MIT (contribution record in [PR #1362](https://github.com/zhu1090093659/dsh-web/pull/1362))
- **doro (朵拉)** — stushansusu, MIT (contribution record in [PR #1630](https://github.com/zhu1090093659/dsh-web/pull/1630)); the "doro" character is an unofficial fan-made meme derivative of Dorothy from *Goddess of Victory: Nikke* — the character and all related rights belong to SHIFT UP, the assets are personal non-commercial use only, and this is not affiliated with the official work (see [THIRD_PARTY_NOTICES.md](packages/dsh-pet/THIRD_PARTY_NOTICES.md))
- **blue-throated-bee-eater (蓝喉蜂虎)** — original to this repository (dsh-web, Apache-2.0; contribution record in [PR #1402](https://github.com/zhu1090093659/dsh-web/pull/1402))
- **starry-doll (星夜人偶)** — Theater-ahyeon, CC BY-NC-SA 4.0 (non-commercial use only)

</details>

## Contributors

<!-- CONTRIBUTORS:START -->
<p align="center">
  <a href="https://github.com/zhu1090093659"><img src="https://github.com/zhu1090093659.png?size=64" width="48" height="48" alt="zhu1090093659" title="zhu1090093659" /></a>
  <a href="https://github.com/Aa728848"><img src="https://github.com/Aa728848.png?size=64" width="48" height="48" alt="Aa728848" title="Aa728848" /></a>
  <a href="https://github.com/stushansusu"><img src="https://github.com/stushansusu.png?size=64" width="48" height="48" alt="stushansusu" title="stushansusu" /></a>
  <a href="https://github.com/thinkmoon"><img src="https://github.com/thinkmoon.png?size=64" width="48" height="48" alt="thinkmoon" title="thinkmoon" /></a>
  <a href="https://github.com/sharkymew"><img src="https://github.com/sharkymew.png?size=64" width="48" height="48" alt="sharkymew" title="sharkymew" /></a>
  <a href="https://github.com/Theater-ahyeon"><img src="https://github.com/Theater-ahyeon.png?size=64" width="48" height="48" alt="Theater-ahyeon" title="Theater-ahyeon" /></a>
  <a href="https://github.com/mkloveyy"><img src="https://github.com/mkloveyy.png?size=64" width="48" height="48" alt="mkloveyy" title="mkloveyy" /></a>
  <a href="https://github.com/Nath-Vikky"><img src="https://github.com/Nath-Vikky.png?size=64" width="48" height="48" alt="Nath-Vikky" title="Nath-Vikky" /></a>
  <a href="https://github.com/yezi4271"><img src="https://github.com/yezi4271.png?size=64" width="48" height="48" alt="yezi4271" title="yezi4271" /></a>
  <a href="https://github.com/whitelonng"><img src="https://github.com/whitelonng.png?size=64" width="48" height="48" alt="whitelonng" title="whitelonng" /></a>
  <a href="https://github.com/Qiuner"><img src="https://github.com/Qiuner.png?size=64" width="48" height="48" alt="Qiuner" title="Qiuner" /></a>
  <a href="https://github.com/guomengjia618-dot"><img src="https://github.com/guomengjia618-dot.png?size=64" width="48" height="48" alt="guomengjia618-dot" title="guomengjia618-dot" /></a>
  <a href="https://github.com/SnowNightt"><img src="https://github.com/SnowNightt.png?size=64" width="48" height="48" alt="SnowNightt" title="SnowNightt" /></a>
  <a href="https://github.com/ch1bug"><img src="https://github.com/ch1bug.png?size=64" width="48" height="48" alt="ch1bug" title="ch1bug" /></a>
  <a href="https://github.com/suharvest"><img src="https://github.com/suharvest.png?size=64" width="48" height="48" alt="suharvest" title="suharvest" /></a>
  <a href="https://github.com/chemmy-11"><img src="https://github.com/chemmy-11.png?size=64" width="48" height="48" alt="chemmy-11" title="chemmy-11" /></a>
  <a href="https://github.com/wingsky-1"><img src="https://github.com/wingsky-1.png?size=64" width="48" height="48" alt="wingsky-1" title="wingsky-1" /></a>
  <a href="https://github.com/Menghuan1918"><img src="https://github.com/Menghuan1918.png?size=64" width="48" height="48" alt="Menghuan1918" title="Menghuan1918" /></a>
  <a href="https://github.com/4evercool"><img src="https://github.com/4evercool.png?size=64" width="48" height="48" alt="4evercool" title="4evercool" /></a>
  <a href="https://github.com/JiewiW"><img src="https://github.com/JiewiW.png?size=64" width="48" height="48" alt="JiewiW" title="JiewiW" /></a>
  <a href="https://github.com/Qinling-Melon-Farmers"><img src="https://github.com/Qinling-Melon-Farmers.png?size=64" width="48" height="48" alt="Qinling-Melon-Farmers" title="Qinling-Melon-Farmers" /></a>
  <a href="https://github.com/PerryLink"><img src="https://github.com/PerryLink.png?size=64" width="48" height="48" alt="PerryLink" title="PerryLink" /></a>
  <a href="https://github.com/isdoge"><img src="https://github.com/isdoge.png?size=64" width="48" height="48" alt="isdoge" title="isdoge" /></a>
  <a href="https://github.com/Xeehho"><img src="https://github.com/Xeehho.png?size=64" width="48" height="48" alt="Xeehho" title="Xeehho" /></a>
  <a href="https://github.com/EricWang1358"><img src="https://github.com/EricWang1358.png?size=64" width="48" height="48" alt="EricWang1358" title="EricWang1358" /></a>
  <a href="https://github.com/DDDMUC"><img src="https://github.com/DDDMUC.png?size=64" width="48" height="48" alt="DDDMUC" title="DDDMUC" /></a>
  <a href="https://github.com/skymecode"><img src="https://github.com/skymecode.png?size=64" width="48" height="48" alt="skymecode" title="skymecode" /></a>
  <a href="https://github.com/GreenLv"><img src="https://github.com/GreenLv.png?size=64" width="48" height="48" alt="GreenLv" title="GreenLv" /></a>
  <a href="https://github.com/oh-wang"><img src="https://github.com/oh-wang.png?size=64" width="48" height="48" alt="oh-wang" title="oh-wang" /></a>
  <a href="https://github.com/TiankunDai"><img src="https://github.com/TiankunDai.png?size=64" width="48" height="48" alt="TiankunDai" title="TiankunDai" /></a>
  <a href="https://github.com/Small-tailqwq"><img src="https://github.com/Small-tailqwq.png?size=64" width="48" height="48" alt="Small-tailqwq" title="Small-tailqwq" /></a>
  <a href="https://github.com/Grivn"><img src="https://github.com/Grivn.png?size=64" width="48" height="48" alt="Grivn" title="Grivn" /></a>
  <a href="https://github.com/ads4395-prog"><img src="https://github.com/ads4395-prog.png?size=64" width="48" height="48" alt="ads4395-prog" title="ads4395-prog" /></a>
  <a href="https://github.com/matriox1003"><img src="https://github.com/matriox1003.png?size=64" width="48" height="48" alt="matriox1003" title="matriox1003" /></a>
  <a href="https://github.com/spacexun2"><img src="https://github.com/spacexun2.png?size=64" width="48" height="48" alt="spacexun2" title="spacexun2" /></a>
  <a href="https://github.com/xiaoyuyu6420"><img src="https://github.com/xiaoyuyu6420.png?size=64" width="48" height="48" alt="xiaoyuyu6420" title="xiaoyuyu6420" /></a>
  <a href="https://github.com/z953218350"><img src="https://github.com/z953218350.png?size=64" width="48" height="48" alt="z953218350" title="z953218350" /></a>
  <a href="https://github.com/guo6x"><img src="https://github.com/guo6x.png?size=64" width="48" height="48" alt="guo6x" title="guo6x" /></a>
  <a href="https://github.com/LittleDarkZero"><img src="https://github.com/LittleDarkZero.png?size=64" width="48" height="48" alt="LittleDarkZero" title="LittleDarkZero" /></a>
  <a href="https://github.com/xohmai"><img src="https://github.com/xohmai.png?size=64" width="48" height="48" alt="xohmai" title="xohmai" /></a>
  <a href="https://github.com/YEYUbaka"><img src="https://github.com/YEYUbaka.png?size=64" width="48" height="48" alt="YEYUbaka" title="YEYUbaka" /></a>
  <a href="https://github.com/suyicon"><img src="https://github.com/suyicon.png?size=64" width="48" height="48" alt="suyicon" title="suyicon" /></a>
  <a href="https://github.com/dickpy"><img src="https://github.com/dickpy.png?size=64" width="48" height="48" alt="dickpy" title="dickpy" /></a>
  <a href="https://github.com/JsonFish"><img src="https://github.com/JsonFish.png?size=64" width="48" height="48" alt="JsonFish" title="JsonFish" /></a>
  <a href="https://github.com/Abyss-Seeker"><img src="https://github.com/Abyss-Seeker.png?size=64" width="48" height="48" alt="Abyss-Seeker" title="Abyss-Seeker" /></a>
  <a href="https://github.com/online111111"><img src="https://github.com/online111111.png?size=64" width="48" height="48" alt="online111111" title="online111111" /></a>
  <a href="https://github.com/Zacklinkk"><img src="https://github.com/Zacklinkk.png?size=64" width="48" height="48" alt="Zacklinkk" title="Zacklinkk" /></a>
  <a href="https://github.com/Noob-stupid"><img src="https://github.com/Noob-stupid.png?size=64" width="48" height="48" alt="Noob-stupid" title="Noob-stupid" /></a>
  <a href="https://github.com/weike-zhang"><img src="https://github.com/weike-zhang.png?size=64" width="48" height="48" alt="weike-zhang" title="weike-zhang" /></a>
  <a href="https://github.com/BlessedWithLuck1105"><img src="https://github.com/BlessedWithLuck1105.png?size=64" width="48" height="48" alt="BlessedWithLuck1105" title="BlessedWithLuck1105" /></a>
  <a href="https://github.com/RevolutionLA"><img src="https://github.com/RevolutionLA.png?size=64" width="48" height="48" alt="RevolutionLA" title="RevolutionLA" /></a>
  <a href="https://github.com/Richard-Peng402"><img src="https://github.com/Richard-Peng402.png?size=64" width="48" height="48" alt="Richard-Peng402" title="Richard-Peng402" /></a>
  <a href="https://github.com/liiydong"><img src="https://github.com/liiydong.png?size=64" width="48" height="48" alt="liiydong" title="liiydong" /></a>
  <a href="https://github.com/logan0116"><img src="https://github.com/logan0116.png?size=64" width="48" height="48" alt="logan0116" title="logan0116" /></a>
  <a href="https://github.com/nicecx"><img src="https://github.com/nicecx.png?size=64" width="48" height="48" alt="nicecx" title="nicecx" /></a>
  <a href="https://github.com/nickkkkkk123123"><img src="https://github.com/nickkkkkk123123.png?size=64" width="48" height="48" alt="nickkkkkk123123" title="nickkkkkk123123" /></a>
  <a href="https://github.com/lpreterite"><img src="https://github.com/lpreterite.png?size=64" width="48" height="48" alt="lpreterite" title="lpreterite" /></a>
  <a href="https://github.com/Jamsharden"><img src="https://github.com/Jamsharden.png?size=64" width="48" height="48" alt="Jamsharden" title="Jamsharden" /></a>
  <a href="https://github.com/neystan"><img src="https://github.com/neystan.png?size=64" width="48" height="48" alt="neystan" title="neystan" /></a>
  <a href="https://github.com/qzhqzh"><img src="https://github.com/qzhqzh.png?size=64" width="48" height="48" alt="qzhqzh" title="qzhqzh" /></a>
  <a href="https://github.com/rainow"><img src="https://github.com/rainow.png?size=64" width="48" height="48" alt="rainow" title="rainow" /></a>
  <a href="https://github.com/rongxingda"><img src="https://github.com/rongxingda.png?size=64" width="48" height="48" alt="rongxingda" title="rongxingda" /></a>
  <a href="https://github.com/lemonmmice"><img src="https://github.com/lemonmmice.png?size=64" width="48" height="48" alt="lemonmmice" title="lemonmmice" /></a>
  <a href="https://github.com/kyrie204"><img src="https://github.com/kyrie204.png?size=64" width="48" height="48" alt="kyrie204" title="kyrie204" /></a>
  <a href="https://github.com/kop022"><img src="https://github.com/kop022.png?size=64" width="48" height="48" alt="kop022" title="kop022" /></a>
  <a href="https://github.com/wang-kaopu"><img src="https://github.com/wang-kaopu.png?size=64" width="48" height="48" alt="wang-kaopu" title="wang-kaopu" /></a>
  <a href="https://github.com/dongwenxiu83-web"><img src="https://github.com/dongwenxiu83-web.png?size=64" width="48" height="48" alt="dongwenxiu83-web" title="dongwenxiu83-web" /></a>
  <a href="https://github.com/heyizhiyuan"><img src="https://github.com/heyizhiyuan.png?size=64" width="48" height="48" alt="heyizhiyuan" title="heyizhiyuan" /></a>
  <a href="https://github.com/ma15803216102"><img src="https://github.com/ma15803216102.png?size=64" width="48" height="48" alt="ma15803216102" title="ma15803216102" /></a>
  <a href="https://github.com/Chimney"><img src="https://github.com/Chimney.png?size=64" width="48" height="48" alt="Chimney" title="Chimney" /></a>
  <a href="https://github.com/viplocco"><img src="https://github.com/viplocco.png?size=64" width="48" height="48" alt="viplocco" title="viplocco" /></a>
  <a href="https://github.com/activeing123"><img src="https://github.com/activeing123.png?size=64" width="48" height="48" alt="activeing123" title="activeing123" /></a>
  <a href="https://github.com/Zhiyi-Zhao"><img src="https://github.com/Zhiyi-Zhao.png?size=64" width="48" height="48" alt="Zhiyi-Zhao" title="Zhiyi-Zhao" /></a>
  <a href="https://github.com/JAVA-LW"><img src="https://github.com/JAVA-LW.png?size=64" width="48" height="48" alt="JAVA-LW" title="JAVA-LW" /></a>
  <a href="https://github.com/AngleNaris"><img src="https://github.com/AngleNaris.png?size=64" width="48" height="48" alt="AngleNaris" title="AngleNaris" /></a>
  <a href="https://github.com/ShiroEirin"><img src="https://github.com/ShiroEirin.png?size=64" width="48" height="48" alt="ShiroEirin" title="ShiroEirin" /></a>
  <a href="https://github.com/zxkk97984-creator"><img src="https://github.com/zxkk97984-creator.png?size=64" width="48" height="48" alt="zxkk97984-creator" title="zxkk97984-creator" /></a>
  <a href="https://github.com/yiyueawa"><img src="https://github.com/yiyueawa.png?size=64" width="48" height="48" alt="yiyueawa" title="yiyueawa" /></a>
  <a href="https://github.com/wertyq111"><img src="https://github.com/wertyq111.png?size=64" width="48" height="48" alt="wertyq111" title="wertyq111" /></a>
  <a href="https://github.com/zbsph"><img src="https://github.com/zbsph.png?size=64" width="48" height="48" alt="zbsph" title="zbsph" /></a>
  <a href="https://github.com/yufengnigel"><img src="https://github.com/yufengnigel.png?size=64" width="48" height="48" alt="yufengnigel" title="yufengnigel" /></a>
  <a href="https://github.com/yongshuai0314"><img src="https://github.com/yongshuai0314.png?size=64" width="48" height="48" alt="yongshuai0314" title="yongshuai0314" /></a>
  <a href="https://github.com/yindf"><img src="https://github.com/yindf.png?size=64" width="48" height="48" alt="yindf" title="yindf" /></a>
  <a href="https://github.com/xiaobin"><img src="https://github.com/xiaobin.png?size=64" width="48" height="48" alt="xiaobin" title="xiaobin" /></a>
  <a href="https://github.com/wszhoho"><img src="https://github.com/wszhoho.png?size=64" width="48" height="48" alt="wszhoho" title="wszhoho" /></a>
  <a href="https://github.com/wsy222"><img src="https://github.com/wsy222.png?size=64" width="48" height="48" alt="wsy222" title="wsy222" /></a>
  <a href="https://github.com/wig123"><img src="https://github.com/wig123.png?size=64" width="48" height="48" alt="wig123" title="wig123" /></a>
  <a href="https://github.com/v833"><img src="https://github.com/v833.png?size=64" width="48" height="48" alt="v833" title="v833" /></a>
  <a href="https://github.com/user-A100"><img src="https://github.com/user-A100.png?size=64" width="48" height="48" alt="user-A100" title="user-A100" /></a>
  <a href="https://github.com/tr1v3r"><img src="https://github.com/tr1v3r.png?size=64" width="48" height="48" alt="tr1v3r" title="tr1v3r" /></a>
  <a href="https://github.com/starryrbs"><img src="https://github.com/starryrbs.png?size=64" width="48" height="48" alt="starryrbs" title="starryrbs" /></a>
  <a href="https://github.com/SnowCrescenter-tech"><img src="https://github.com/SnowCrescenter-tech.png?size=64" width="48" height="48" alt="SnowCrescenter-tech" title="SnowCrescenter-tech" /></a>
  <a href="https://github.com/slywalker2006"><img src="https://github.com/slywalker2006.png?size=64" width="48" height="48" alt="slywalker2006" title="slywalker2006" /></a>
  <a href="https://github.com/Sivan757"><img src="https://github.com/Sivan757.png?size=64" width="48" height="48" alt="Sivan757" title="Sivan757" /></a>
  <a href="https://github.com/sclass53"><img src="https://github.com/sclass53.png?size=64" width="48" height="48" alt="sclass53" title="sclass53" /></a>
  <a href="https://github.com/PcHeN0720"><img src="https://github.com/PcHeN0720.png?size=64" width="48" height="48" alt="PcHeN0720" title="PcHeN0720" /></a>
  <a href="https://github.com/OctKwong30"><img src="https://github.com/OctKwong30.png?size=64" width="48" height="48" alt="OctKwong30" title="OctKwong30" /></a>
  <a href="https://github.com/Nwflower"><img src="https://github.com/Nwflower.png?size=64" width="48" height="48" alt="Nwflower" title="Nwflower" /></a>
  <a href="https://github.com/Moeblack"><img src="https://github.com/Moeblack.png?size=64" width="48" height="48" alt="Moeblack" title="Moeblack" /></a>
  <a href="https://github.com/Lem0nTea2002"><img src="https://github.com/Lem0nTea2002.png?size=64" width="48" height="48" alt="Lem0nTea2002" title="Lem0nTea2002" /></a>
  <a href="https://github.com/LHMQ878"><img src="https://github.com/LHMQ878.png?size=64" width="48" height="48" alt="LHMQ878" title="LHMQ878" /></a>
  <a href="https://github.com/jcaiagent7143-ui"><img src="https://github.com/jcaiagent7143-ui.png?size=64" width="48" height="48" alt="jcaiagent7143-ui" title="jcaiagent7143-ui" /></a>
  <a href="https://github.com/JUANWANG-BUAA"><img src="https://github.com/JUANWANG-BUAA.png?size=64" width="48" height="48" alt="JUANWANG-BUAA" title="JUANWANG-BUAA" /></a>
  <a href="https://github.com/Izgenlre"><img src="https://github.com/Izgenlre.png?size=64" width="48" height="48" alt="Izgenlre" title="Izgenlre" /></a>
  <a href="https://github.com/NuCl34R"><img src="https://github.com/NuCl34R.png?size=64" width="48" height="48" alt="NuCl34R" title="NuCl34R" /></a>
  <a href="https://github.com/HAN102300"><img src="https://github.com/HAN102300.png?size=64" width="48" height="48" alt="HAN102300" title="HAN102300" /></a>
  <a href="https://github.com/superman32432432"><img src="https://github.com/superman32432432.png?size=64" width="48" height="48" alt="superman32432432" title="superman32432432" /></a>
  <a href="https://github.com/FoolishWiser"><img src="https://github.com/FoolishWiser.png?size=64" width="48" height="48" alt="FoolishWiser" title="FoolishWiser" /></a>
  <a href="https://github.com/farobute"><img src="https://github.com/farobute.png?size=64" width="48" height="48" alt="farobute" title="farobute" /></a>
  <a href="https://github.com/DavidWanm"><img src="https://github.com/DavidWanm.png?size=64" width="48" height="48" alt="DavidWanm" title="DavidWanm" /></a>
  <a href="https://github.com/DamonKoy"><img src="https://github.com/DamonKoy.png?size=64" width="48" height="48" alt="DamonKoy" title="DamonKoy" /></a>
  <a href="https://github.com/aexachao"><img src="https://github.com/aexachao.png?size=64" width="48" height="48" alt="aexachao" title="aexachao" /></a>
  <a href="https://github.com/ch3n4y"><img src="https://github.com/ch3n4y.png?size=64" width="48" height="48" alt="ch3n4y" title="ch3n4y" /></a>
  <a href="https://github.com/Beverly621"><img src="https://github.com/Beverly621.png?size=64" width="48" height="48" alt="Beverly621" title="Beverly621" /></a>
  <a href="https://github.com/AmethystLuna"><img src="https://github.com/AmethystLuna.png?size=64" width="48" height="48" alt="AmethystLuna" title="AmethystLuna" /></a>
  <a href="https://github.com/AlfredChaos"><img src="https://github.com/AlfredChaos.png?size=64" width="48" height="48" alt="AlfredChaos" title="AlfredChaos" /></a>
  <a href="https://github.com/Aik358"><img src="https://github.com/Aik358.png?size=64" width="48" height="48" alt="Aik358" title="Aik358" /></a>
  <a href="https://github.com/liaoyonghong"><img src="https://github.com/liaoyonghong.png?size=64" width="48" height="48" alt="liaoyonghong" title="liaoyonghong" /></a>
  <a href="https://github.com/YeqingTang"><img src="https://github.com/YeqingTang.png?size=64" width="48" height="48" alt="YeqingTang" title="YeqingTang" /></a>
  <a href="https://github.com/cncolder"><img src="https://github.com/cncolder.png?size=64" width="48" height="48" alt="cncolder" title="cncolder" /></a>
  <a href="https://github.com/great-man2096"><img src="https://github.com/great-man2096.png?size=64" width="48" height="48" alt="great-man2096" title="great-man2096" /></a>
  <a href="https://github.com/Starfie1d1272"><img src="https://github.com/Starfie1d1272.png?size=64" width="48" height="48" alt="Starfie1d1272" title="Starfie1d1272" /></a>
  <a href="https://github.com/WyxBUPT-22"><img src="https://github.com/WyxBUPT-22.png?size=64" width="48" height="48" alt="WyxBUPT-22" title="WyxBUPT-22" /></a>
  <a href="https://github.com/Wike-CHI"><img src="https://github.com/Wike-CHI.png?size=64" width="48" height="48" alt="Wike-CHI" title="Wike-CHI" /></a>
  <a href="https://github.com/CCMKCCMK"><img src="https://github.com/CCMKCCMK.png?size=64" width="48" height="48" alt="CCMKCCMK" title="CCMKCCMK" /></a>
  <a href="https://github.com/wanpan11"><img src="https://github.com/wanpan11.png?size=64" width="48" height="48" alt="wanpan11" title="wanpan11" /></a>
  <a href="https://github.com/Walvez"><img src="https://github.com/Walvez.png?size=64" width="48" height="48" alt="Walvez" title="Walvez" /></a>
  <a href="https://github.com/Volta-ln"><img src="https://github.com/Volta-ln.png?size=64" width="48" height="48" alt="Volta-ln" title="Volta-ln" /></a>
  <a href="https://github.com/UnusWhite"><img src="https://github.com/UnusWhite.png?size=64" width="48" height="48" alt="UnusWhite" title="UnusWhite" /></a>
  <a href="https://github.com/Ultronen"><img src="https://github.com/Ultronen.png?size=64" width="48" height="48" alt="Ultronen" title="Ultronen" /></a>
  <a href="https://github.com/Twelveeee"><img src="https://github.com/Twelveeee.png?size=64" width="48" height="48" alt="Twelveeee" title="Twelveeee" /></a>
  <a href="https://github.com/Tinger-X"><img src="https://github.com/Tinger-X.png?size=64" width="48" height="48" alt="Tinger-X" title="Tinger-X" /></a>
  <a href="https://github.com/mrSutivu"><img src="https://github.com/mrSutivu.png?size=64" width="48" height="48" alt="mrSutivu" title="mrSutivu" /></a>
  <a href="https://github.com/Signalight"><img src="https://github.com/Signalight.png?size=64" width="48" height="48" alt="Signalight" title="Signalight" /></a>
  <a href="https://github.com/Scotlight"><img src="https://github.com/Scotlight.png?size=64" width="48" height="48" alt="Scotlight" title="Scotlight" /></a>
  <a href="https://github.com/NikolaFC"><img src="https://github.com/NikolaFC.png?size=64" width="48" height="48" alt="NikolaFC" title="NikolaFC" /></a>
  <a href="https://github.com/RINGOLINK"><img src="https://github.com/RINGOLINK.png?size=64" width="48" height="48" alt="RINGOLINK" title="RINGOLINK" /></a>
  <a href="https://github.com/QIU0826"><img src="https://github.com/QIU0826.png?size=64" width="48" height="48" alt="QIU0826" title="QIU0826" /></a>
</p>
<p align="center">
  <sub><a href="https://github.com/zhu1090093659/dsh-web/graphs/contributors">View all contributors</a></sub>
</p>
<!-- CONTRIBUTORS:END -->

<div align="center">

**If you like it, give us a star.**

[Report Bug](https://github.com/zhu1090093659/dsh-web/issues) · [Request Feature](https://github.com/zhu1090093659/dsh-web/issues) · [View Releases](https://github.com/zhu1090093659/dsh-web/releases)

</div>

## Support the Project

Thank you to everyone who uses, gives feedback on and contributes to dsh-web. If this project helps you, you are welcome to scan the QR code to support its continued maintenance and development:

<p align="center">
  <img src="docs/zanzhu-wechat.jpg" alt="WeChat sponsorship QR code" width="360">
</p>