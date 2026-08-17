# @linxin666/dsh-client-ui-shutdown

English | [中文](README.zh.md)

A single power button (Windows shutdown icon) floating at the bottom-right corner of the DSH Web page. Clicking it opens a confirm dialog; confirming asks the host process to exit DeepSeek Harness gracefully.

## What it does

- **One button only**: one floating power button at the bottom-right corner of the page — a 46px circle with a shadow, always visible regardless of the sidebar layout.
- **Confirm dialog**: clicking the button opens a modal asking for confirmation, because exiting ends the dsh web process and may interrupt running sessions and tasks. The dialog can be bypassed through the `confirmShutdown` setting. Once confirmed and acknowledged by the host, the page closes itself (`window.close()`; browsers that forbid script-closing a tab fall back to a blank tab) before the process exits.
- **Graceful exit**: the confirmed request POSTs to the loopback-only `/api/dsh-shutdown` route. The host writes the acknowledgement first, then requests `ctx.appExit` — the launcher-provided bounded exit that disposes the plugin tree before the process ends. When the launcher service is absent (hand-built trees, tests), the host falls back to `process.exit(0)`.
- **Settings card**: a card in Settings > Plugin config toggles the button, the confirm gate, and the agent announcement.

## Installation

Install the family aggregate package `@linxin666/dsh-web-ui-all` (all plugins and skins in one) or this plugin alone:

```sh
# Recommended: install directly from npm
dsh plugin --profile web add @linxin666/dsh-client-ui-shutdown

# Or from the repository (development loop)
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-shutdown

```

Restart `dsh web`; the power button appears at the bottom-right corner of the page.

Alternatively, as a plain overlay row in the personal DSH overlay (`~/.dsh/config.yaml`), hot-reloaded on save:

```yaml
- insert:
    - id: shutdown
      name: '@linxin666/dsh-client-ui-shutdown'
```

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Master switch for the plugin (button + host surfaces) |
| `confirmShutdown` | `boolean` | `true` | Ask for confirmation before exiting; `false` exits immediately on click |
| `announceToAgent` | `boolean` | `true` | Announce the plugin in the system prompt |

## Security model

- The `/api/dsh-shutdown` route is **loopback-only**: it rejects LAN and cross-origin requests, because it terminates the host process. The fence mirrors the family SSH route fence (loopback address + same-origin markers).
- Exiting is a real shutdown: the dsh web process ends, so anything running in it (agent sessions, scheduled tasks, unsaved state) is interrupted. The confirm dialog is the default guard.

## Known Limitations

- The exit only disposes as much as the launcher's `appExit` controller disposes; the fallback `process.exit(0)` path (no launcher) skips graceful teardown.
- The button floats at the bottom-right corner of the Web GUI; there is no TUI equivalent.
- The browser half cannot force the process to exit by itself — it depends on the host route being mounted by this same plugin.
