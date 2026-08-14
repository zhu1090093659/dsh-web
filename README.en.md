# dsh-web-ui · DSH Web UI

[中文](README.md) | English

![dsh-web-ui](docs/dsh-web-ui-banner.png)

dsh-web-ui is a collection of plugins and skins for the DeepSeek Harness (DSH) Web UI: a task board, a Git graph, the right panel, mobile remote control, remote connection, a whale-girl pet, live token statistics, and the Skin Center. Every plugin can be installed individually, or all at once through the aggregate packages.

![DSH Web UI main screen](docs/screenshots/13-hero-main.png)

## Feature Plugins

### Task Board

Open it from the sidebar. Tasks are organized into five columns: Planned, To-do, In Progress, Done, and Failed. Clicking "Run" on a card hands the task to a real DSH agent session; when it finishes, the card status updates automatically. To review what happened, jump directly into the execution session for the full transcript.

Tasks also support scheduled execution: configure a cron expression in the detail view (e.g. auto-upgrade DSH at 23:00 daily, generate a weekly report at 09:00 every Monday), and the task runs on its own at the scheduled time.

| Multi-column board | Scheduled execution |
| --- | --- |
| ![Task board](docs/screenshots/09-task-board.png) | ![Scheduled task detail](docs/screenshots/10-task-board-detail-cron.png) |

### Git Graph

The branch picker above the input box handles branch switching and commit history browsing; the Git graph visualizes branch lanes and commit history, making it easy to trace changes along the timeline even in large repositories.

![Git graph](docs/screenshots/04-git-graph.png)

### Right Panel

When a project session is open, two panels appear to the right of the chat area — "Preview" and "Files/Changes":

- **File tree**: browse the working directory; click a file to open it in the preview panel, click a folder row to expand it, and search for files by name;
- **Preview**: multi-tab preview for markdown, HTML, code, diff, CSV, PDF, Office, images and plain text, with source/preview switching, split-screen editing and saving;
- **Changes (SCM)**: a real git changes panel with stage / unstage / discard;
- Panel widths are draggable (double-click a handle to reset), and the collapsed state plus widths persist per project;
- All eight skins adapt the right panel — switching skins restyles the panels to match the theme.

![Right panel](docs/screenshots/19-right-panel.png)

### Whale-Girl Pet

A whale girl who lives at the edge of the interface and switches animations with the agent's state: thinking, waiting, working, celebrating. Click her to interact (pet her head), feed her dried fish to raise affinity, and grow her from a baby whale to "deep-sea bond". She can be renamed, dragged to any position, or hidden whenever you want.

| Working companion | Interaction panel |
| --- | --- |
| ![Whale pet](docs/screenshots/11-pet-new-chat.png) | ![Pet interaction panel](docs/screenshots/12-pet-panel.png) |

### Live Token Stats

Real-time usage shown directly below the input box: generation speed (TPS), LLM time, context usage, cache hit rate, and input / output token counts — the cost of every generation stays visible at a glance.

![Live token stats](docs/screenshots/18-live-stats.png)

### Mobile Remote Control

The phone icon at the bottom of the sidebar opens the pairing panel: scan the QR code (or copy the link) to pair, and the phone lands on a standalone mobile surface that remote-controls the current dsh web workspace — browse and create sessions, send and receive messages, switch models and reasoning effort, and adjust the permission preset, all in sync with the desktop. Pairing tokens are one-time and time-limited; "Stop" revokes every paired device at any time. The QR defaults to the LAN, or turn on the cloudflared public tunnel so the phone can pair from any network.

| Workspaces | Sessions & new session |
| --- | --- |
| ![Mobile workspaces](docs/screenshots/20-mobile-workspaces.png) | ![Mobile sessions](docs/screenshots/21-mobile-sessions.png) |
| Chat (folded reasoning & tool calls) | Model & reasoning-effort picker |
| ![Mobile chat](docs/screenshots/22-mobile-chat.png) | ![Model picker](docs/screenshots/23-mobile-model-sheet.png) |

### Remote Connection

The "SSH" sidebar entry opens the remote-ops panel. Hosts support key / password auth and one-click import from `~/.ssh/config`; config lives in `~/.dsh/dsh-ssh.json`. Real operations on configured hosts:

- **Web terminal**: xterm.js PTY with live output and auto-fit;
- **File transfer**: SFTP upload / download with progress and a remote directory browser;
- **Port forwarding**: local tunnels to remote internal services (databases, APIs, admin consoles), bound to 127.0.0.1 only;
- **Cluster runs**: one command across many hosts concurrently, filtered by alias / environment / tags;
- **Agent direct control**: agents share the same host config — just say "check xxx" in chat and the agent runs remote commands for you.

### Settings Hub

All family plugins' toggles and parameters live under "Settings > Plugin config", and changes apply immediately.

![Plugin config hub](docs/screenshots/02-settings-web-ui-plugins.png)

## Skins

The skin center ships eight skins, each supporting try-on before applying: preview applies instantly and reverts fully on exit; once you are satisfied, apply it with one click.

![Skin center](docs/screenshots/03-settings-skin-center.png)

### Windows XP (Luna)

A faithful recreation of the classic Luna interface: blue gradient window chrome, a green Start button, the Bliss blue-sky desktop, and square corners throughout.

![Windows XP skin](docs/screenshots/16-skin-xp-light.png)

### Minecraft Voxel

Inspired by the Minecraft main menu: a pixel-art panorama skybox rotates slowly behind the interface, buttons adopt the gray stone slab style, and inputs become wooden sign posts.

![Minecraft skin](docs/screenshots/15-skin-minecraft-light.png)

### Blue Fantasy

Whale artwork lies beneath translucent panes, wrapped in a periwinkle-indigo palette — particularly striking in dark mode.

![Blue Fantasy dark](docs/screenshots/17-skin-blue-fantasy-dark.png)

### Whale Song

The deep-sea whale-goddess theme: a text-free ambience painting (a blue-haired goddess with a whale pod on the left, an ice-blue constellation grid with gold-thread accents, and generous open water on the right) sits beneath translucent panes, wrapped in an ice-blue / cyan / navy / cobalt palette — with a night-cruise dark variant.

![Whale Song light](docs/screenshots/24-skin-whale-song-light.png) · ![Whale Song dark](docs/screenshots/25-skin-whale-song-dark.png)

### Trading Terminal

A live-data stock-trading skin: a scrolling ticker tape (A-shares / HK / US / indices / crypto / FX, 红涨绿跌), live quote chips in the title bar, and a status bar with A-share / HK / US trading sessions plus HK/US index cells. With `dsh-fun-ticker` installed the tape follows your watchlist (served through its same-origin proxy); with `dsh-longbridge` installed the index cells render the broker snapshot. With neither plugin installed the skin still works standalone on public feeds (Tencent / Binance / Frankfurter) — and every fetch path fails safe to `--` cells.

![Trading Terminal light](docs/screenshots/26-skin-trading-light.png) · ![Trading Terminal dark](docs/screenshots/27-skin-trading-dark.png)

Three more: QQ2008 Retro (crystal blue with penguin motifs), Tonghuashun Trading (market elements woven into the interface), and Dragon Heir (cinnabar dragon seal theme).

## Installation

DSH plugins are installed per **profile** with the `dsh plugin` command (`dsh web` runs the `web` profile). The recommended way is the aggregate package `dsh-web-ui-all` — one package with all plugins and skins; install `dsh-skins` instead if you only want the skins.

### Option 1: Install from npm (recommended)

The plugins are published to npm (the `@linxin666` scope) — one command installs everything:

```sh
dsh plugin --profile web add @linxin666/dsh-web-ui-all@0.1.10
```

Restart `dsh web` and all plugin entries appear in the sidebar. Skins only? Install `@linxin666/dsh-skins` instead.

> Pinned to the current latest release `0.1.10`. The `0.1.1` build of `dsh-pet` shipped without runtime files (`lib/types/*.js`), and some environments may resolve npm's `latest` from a stale registry cache — pinning the version is the safest install; bump `@0.1.10` to the new version when upgrading.

> First install may stop on `ERR_PNPM_IGNORED_BUILDS` (pnpm blocks dependency build scripts): copy the printed keys (`cloudflared` / `cpu-features` / `ssh2`) into the profile's `pnpm-workspace.yaml` `allowBuilds` list and re-run.

### Option 2: Install from the GitHub repository (development)

The packages are already on npm; installing from this repository is only for development (requires Node.js >= 22 and pnpm):

```sh
# 1. Clone the repository
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui

# 2. Install dependencies and build
pnpm install
pnpm -r build

# 3. Install the aggregate package into the web profile
dsh plugin --profile web add link:$(pwd)/packages/dsh-web-ui-all

# 4. Restart dsh web — all plugin entries appear in the sidebar
dsh web
```

> Skins only? Point step 3 at `packages/dsh-skins` instead.

### Install a single plugin

Prefer individual plugins? Install them one by one (published on npm, so use the package name directly):

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-task-board   # Task board
dsh plugin --profile web add @linxin666/dsh-ssh                    # Remote connection (SSH)
dsh plugin --profile web add @linxin666/dsh-pet                    # Whale-girl pet
```

### Verify and uninstall

After installing, restart `dsh web` — a working plugin shows up in the sidebar. You can also confirm the mounted config layers with `dsh --profile web --dump-config`. If nothing appears in the sidebar, you most likely forgot to restart `dsh web`.

Uninstall: `dsh plugin --profile web remove @linxin666/dsh-web-ui-all`, then restart `dsh web`.

Technical details live in [docs/plugins.md](docs/plugins.md).

## Sources & Licensing

| Package | Origin | License |
| --- | --- | --- |
| dsh-task-board / dsh-git-graph / dsh-aionui-panel / dsh-pet / dsh-remote-web-ui / dsh-live-stats / dsh-web-ui-settings / dsh-skins / dsh-web-ui-all / skins | Authored by zhu1090093659 | BSD-3-Clause (zhu1090093659) |

Third-party code merged in must keep its LICENSE and attribution; active third parties with an upstream are forked or referenced as dependencies instead of vendored.
