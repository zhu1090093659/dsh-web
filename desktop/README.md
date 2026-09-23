# desktop — DeepSeek Harness desktop app

English | [中文](README.zh.md)

An Electron shell that turns the DeepSeek Harness Web GUI into an installable desktop app for macOS and Windows. The installer bundles a standalone Node.js runtime (with npm and pnpm), the dsh host, and a preinstalled web profile (official web bundles plus the dsh-web plugin collection), so the app runs with zero preinstalled tooling — no Node, no npm, no dsh CLI setup.

## What it does

- Double-click launch: the app seeds `~/.dsh/profiles/web` from the bundled profile when it is missing, starts its own dsh host on a dedicated loopback port with the bundled Node runtime, waits for the GUI, and loads the tokenized URL the host prints (the auth fence issues a per-process token; the resulting session cookie lives in the app window).
- Separate host, guaranteed ports: the app always runs its own bundled host — it never attaches to an existing GUI and never binds the plain `dsh web` CLI defaults 3080/3081. It prefers the dedicated 3082-3181 range (a stable address across launches) and falls back to an OS-assigned port if the range is full. The desktop instance and your own `dsh web` run side by side, each with its own GUI session.
- Shares `~/.dsh` with any existing dsh installation: profiles the app seeded itself carry a `.dsh-desktop-seed.json` marker and are re-seeded when the bundled runtime changes; profiles without the marker are user-managed and never touched. The user's `cordis.patch.yml` layer survives re-seeding.
- One window per machine: a second launch focuses the existing window. Closing the window quits the app and gracefully stops the host it spawned (process-group SIGTERM, `taskkill /T` on Windows, forced after 5s).
- In-app plugin management works out of the box: `dsh plugin add/remove` forwards to a pnpm (11.24.0, the repository toolchain version) installed inside the bundled Node runtime, next to the npm the official distribution already ships.
- Background attention reminders (issue #1498): while the window is in the background, the shell flashes the taskbar and plays the system alert when a run is waiting for you (an approval, a question, or a plan review) and when a conversation turn ends. The GUI is ordinary web content and knows nothing about this shell, so a small observer is injected into the page after each load; it reads only official unhashed data attributes (`[data-approval-key]`, `[data-question-key]`, `[data-plan-review-key]`, `[data-chat-flow-kind="turn-tail"]`, `[data-chat-flow-kind="turn-error"]`, `[data-state="stopped"]`), never a CSS-modules hash. A focused window is never raised, and a 4-second cooldown coalesces bursts.
- Startup failures (missing payload, host exit before ready, ready timeout) land on an error page with the host log tail, a Retry button, and a Reveal-log-file button. The full host log lives at the Electron `logs` directory (`dsh-host.log`).

## Repository layout

| Path | Content |
| --- | --- |
| `src/` | Electron main process (`main.cjs`), testable pure helpers (`runtime.cjs`), preload, splash and error pages |
| `runtime/host/` | Pinned `@deepseek-ai/dsh` manifest + pnpm layout (hoisted, multi-platform) |
| `runtime/profile-web/` | Web profile seed manifest: bundles `dsh-base` + `dsh-web-app` + `@linxin666/dsh-web-all` |
| `scripts/fetch-node.mjs` | Downloads + sha256-verifies the bundled Node distributions (`resources/runtime/node-<os>-<cpu>/`) |
| `scripts/fetch-pnpm.mjs` | Installs the pinned pnpm into every bundled Node distribution (npm registry tarball, integrity-verified, npm-style global layout) |
| `scripts/build-runtime.mjs` | pnpm-installs both payloads and stages them into `resources/runtime/` (incl. the Windows `cloudflared.exe` tunnel binary) |
| `scripts/after-pack.cjs` | Copies the staged payload into the packaged app after packing (electron-builder's extraResources would silently drop the payload node_modules) |
| `resources/` | App icons + generated runtime payload (git-ignored) |

## Build

### Prerequisites

The build machine needs Node 22+ and pnpm 11 (the repository toolchain). The packaged app itself needs nothing.

### Steps

```sh
cd desktop
npm install            # electron + electron-builder
npm run prepare-runtime  # fetch Node distributions + install and stage the payload
npm run dist:mac         # dist/*.dmg + *.zip (arm64 + x64)
npm run dist:win         # dist/*.exe (nsis) + *.zip (cross-build from macOS)
```

`npm start` runs the app unpackaged against the staged `resources/runtime/`, for development.

## Config

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `DSH_HOME` | `~/.dsh` | Data home shared with the dsh CLI (config, sessions, keys). Set only for isolated testing. |

### Attention reminders

`$DSH_HOME/desktop-attention.json` tunes the background reminders. The file is optional, and only a literal `false` turns a channel off — a typo can never silently disable the reminder:

```json
{ "flash": true, "sound": true }
```

| Field | Default | Meaning |
| --- | --- | --- |
| `flash` | `true` | Flash the taskbar icon while the window is in the background. |
| `sound` | `true` | Play the system alert sound (Electron `shell.beep`). |

The bundled versions are pinned in `runtime/host/package.json` (`@deepseek-ai/dsh`) and `runtime/profile-web/package.json` (`@linxin666/dsh-web-all`) and recorded into `resources/runtime/VERSION.json` at build time.

## Security model

- The dsh host binds loopback only (`127.0.0.1`); `--host 0.0.0.0` is rejected by the host itself.
- The window has no Node integration and a sandboxed preload; navigation is restricted to loopback (and the local splash/error pages), external links open in the system browser.
- The bundled Node distributions are verified against the release SHASUMS256.txt at build time; the bundled pnpm tarball is verified against its npm registry integrity metadata.
- The app only ever writes under `$DSH_HOME` it resolved at startup, the Electron `logs` directory, and its own install location.
- The renderer-to-main attention channel carries one closed enum (`approval` / `completed` / `interrupted`). The main process drops any other payload and any sender that is not the GUI window's web contents, and the page-side observer is a read-only DOM watcher that never touches page state.

## Known limitations

- **Unsigned builds**: macOS shows the Gatekeeper warning on first open (right-click → Open, or `xattr -dr com.apple.quarantine`); Windows shows SmartScreen (More info → Run anyway). Signing and notarization are a planned follow-up.
- **Remote tunnel (`dsh-remote-web-ui`)**: the payload stages the Windows x64 `cloudflared` binary (plus the build machine's own macOS binary), so tunneling works out of the box on macOS arm64 and Windows x64; on macOS x64 the tunnel plugin detects the wrong-arch staged binary on first use and re-fetches the matching one (network required once).
- **Windows arm64 and Linux** are not built; the runtime layout already covers adding them.
- **Interrupted turns are a heuristic**: an errored turn and an interrupted tool call have unhashed hooks, but a turn the user stopped while only assistant text was streaming carries no semantic attribute at all, so it is reported as a completion. Distinguishing it exactly needs the host's `turn/end` reason (`session/follow` over `/api/remote.mux`), which the shell deliberately does not subscribe to.
- **Attention reminders are a desktop-shell feature**: they come from the observer this app injects, so a plain browser tab gets none of them (`dsh-notifier` covers that case).
- First launch on a fresh machine spends a few seconds copying the preinstalled profile into `~/.dsh` (one-time).
- **Two hosts on one `~/.dsh`**: with the desktop app and your own `dsh web` running at the same time, two dsh host processes share the data home. This coexistence is the designed mode — the desktop app never reads or drives your instance; the two GUIs simply keep separate sessions.
