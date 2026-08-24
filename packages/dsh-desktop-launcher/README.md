# @linxin666/dsh-desktop-launcher

English | [中文](README.zh.md)

Create a desktop icon that launches dsh with one double-click: the icon starts
`dsh web` when it is not running, waits for the GUI to become ready, and opens
the browser at the configured URL. Works on Windows (.lnk), macOS (.command)
and Linux (.desktop).

## What it does

- Settings → Plugin configuration → Web UI plugins card with a "Create desktop
  icon" button; the host writes the launcher script under
  `~/.dsh/desktop-launcher/` and places the icon on the Desktop.
- Double-click behavior: probe the GUI URL; if it responds, open the browser without starting another process. Otherwise start `dsh web --no-open` in the background (hidden on Windows), poll for up to 30 seconds, then let the launcher open exactly one browser tab. Closing that tab does not stop the backend; use the in-page power button to exit DSH explicitly. If the `dsh` command is missing, the launcher shows a message instead of failing silently.
- The launcher is regenerated from the live settings each time you click the
  button, so `dshCommand`, `url` and `profile` changes apply on the next
  creation without editing the icon target.
- Windows launcher and shortcut-installer scripts are written as UTF-8 with a BOM for Windows PowerShell 5.1 and non-ASCII user paths. Command lookup prefers the npm `dsh.cmd`/executable shim over `dsh.ps1`; a PowerShell-script-only fallback is invoked explicitly through `powershell.exe` rather than through file association.
- The Windows shortcut uses the DeepSeek Harness whale icon (white background)
  and shows a styled "starting" popup instead of a console window: it reports
  progress (starting dsh, waiting for the GUI) and surfaces failures (missing
  command, timeout) with a Close button.

## Install

### From npm (recommended)

```sh
dsh plugin --profile web add @linxin666/dsh-desktop-launcher
```

### From the repository (development)

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install
pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-desktop-launcher
```

Restart `dsh web`, open Settings → Plugin configuration → Web UI plugins,
enable the plugin (it ships off by default), and click "Create desktop icon".

## Config

All fields live in the plugin settings card (or in the composition entry):

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | Master switch for the plugin; off by default. |
| `announceToAgent` | `false` | Opt-in: when true, announces the plugin in the system prompt. |
| `dshCommand` | `dsh` | Command that starts dsh; must be on PATH. |
| `url` | `http://127.0.0.1:3080` | GUI URL the launcher waits for and opens. |
| `profile` | unset | Optional profile started with `dsh --profile <name> --no-open`; blank uses `dsh web --no-open`. |
| `iconPath` | unset | Icon file (.ico/.png) for the desktop icon; blank uses the bundled DeepSeek Harness icon. |

## Security model

- The host API is loopback-only: requests from non-local addresses, foreign Host headers and cross-site origins are rejected with 403. Closing a browser tab never requests host shutdown; the explicit shutdown endpoint is the only browser action that terminates DSH.
- The plugin writes only two places: `~/.dsh/desktop-launcher/` (launcher
  scripts) and the user's Desktop directory (the icon).
- On Linux the icon creation best-effort marks the `.desktop` file as trusted
  with `gio`; on desktop environments without `gio` the file still appears but
  may need a manual "allow launching" step.

## Known limitations

- The launcher assumes `dsh` is reachable on PATH at double-click time; if you
  installed dsh outside PATH, set `dshCommand` to the absolute command.
- The 30-second readiness poll is fixed; very slow first starts may time out
  (the launcher then shows a message).
- Creating the icon requires a Desktop directory; OneDrive-redirected Windows
  desktops are detected, other redirects may need a manual icon placement.

## Telemetry

The browser half sends one anonymous install heartbeat per UTC day to dsh-market.com: a random localStorage id plus this package's name, nothing else. The server stores only a salted hash of that id, never IP addresses, and exposes aggregate counts only. See [docs/telemetry.md](../../docs/telemetry.md) for the full contract.

## License

Apache-2.0.
