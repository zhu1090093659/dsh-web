# dsh-browser-view · Live Browser View for DeepSeek Harness (DSH)

English | [中文](README.zh.md)

<p align="center">
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.2--rc.1-4c6ef5?style=flat-square&amp;labelColor=454a54" alt="DSH">
  &nbsp;
  <img src="https://img.shields.io/badge/license-BSD--3--Clause-blue?style=flat-square" alt="License">
</p>

> A browser the agent drives, watched from a tab beside the chat. The host half owns the devtools connection — either to a dedicated Chromium it launches, or to the browser you started with remote debugging switched on — and the browser half contributes one right-sidebar tab type, so the page stays in view while the agent verifies it.

This package is an external plugin for DeepSeek Harness (DSH), structured as a cordis bundle: `src/index.ts` is the host half (Chrome process, CDP sessions, tab registry, WebSocket fan-out, agent tools) and `src/client/` is the browser half (the sidebar tab body and its chip).

## What it does

- **A live tab, not a screenshot poll**: CDP `Page.startScreencast` frames arrive over one WebSocket and are painted as they come. The tab shows the active page, its URL and title, and what the agent last did.
- **Eleven agent tools**: `browser_navigate`, `browser_click`, `browser_type`, `browser_press`, `browser_scroll`, `browser_snapshot`, `browser_screenshot`, `browser_console`, `browser_network`, `browser_tabs`, `browser_close`.
- **Evidence in the conversation**: every `browser_screenshot` result carries the image, so the transcript keeps the picture the agent acted on instead of only a sentence about it.
- **Isolated by default**: the plugin launches its own Chromium with a throwaway profile, so the browser you are signed into is not touched while the mode below stays off.
- **Your own browser on request**: with `realBrowserEnabled` set, the plugin attaches over CDP to a browser you started with remote debugging. Each DSH session on this host can enumerate, read, navigate, click and type in every tab that browser has — tabs that existed before the attach and tabs opened afterwards — and the sign-ins already in that profile work, because the pages run in it and no cookie is imported.
- **Signs itself in to this host's own GUI**: a fresh isolated profile has no session cookie, so the viewer would only ever see the 401 challenge. When a navigation lands on that challenge over loopback, the plugin asks the host's connection service for the same ticketed URL `dsh web` printed, and retries once. The cookie that mints lives in the throwaway profile and dies with it.
- **Closing is explicit**: `browser_close` without a tab id closes only the tabs the calling session opened; a tab of an attached browser closes only when the call names its id. The panel shows no close control for such a tab.

## How it works

```text
agent tool call ──► host half ──► CDP ──► its own Chromium, or your CDP browser
                        │
                        └─ screencast frames ──► WebSocket ──► sidebar tab body
```

In the default isolated mode the host half starts Chrome lazily on the first tool call, pins a viewport, and keeps a ring of console entries and network requests per tab so a verification can be read back without re-running the page. In CDP mode a tab listing or a panel attach opens the same kind of session against the configured endpoint and starts no process of its own. A top-level document replacement clears both rings; a same-document navigation (hash, query, SPA pushState) keeps them.

## Screenshot fidelity

`browser_screenshot` captures a lossless PNG by default: a screenshot is usually looked at more than once, and annotation, thin borders and small labels stay legible instead of turning into JPEG ringing. `format` switches to `jpeg` when a smaller result matters more than exact pixels.

- **Capture a region, not the page**: `clip` takes `{ x, y, width, height }` in CSS pixels, the same coordinate space as a `browser_snapshot` box and the `x`/`y` of `browser_click`. A clipped capture is rendered at 2x unless `scale` says otherwise.
- **`scale` is 1, 2 or 3**: an explicit value always wins over the clip default.
- **Why the extra pixels**: on the model side one visual token cell covers roughly 42x42 px of the image, so a whole-viewport capture is already coarse. To read detail, take the box from `browser_snapshot` and capture only that region; at 2x the same element occupies several times the tokens it did in the full frame.
- **Out of bounds fails loudly**: a `clip` that leaves the pinned viewport (isolated mode, 1280x800) or the tab's real layout viewport (real-browser mode), or an encoded image over the host's attachment budget, is an error naming the reason. No image comes back for a region that was never rendered.

## Interface seats

| Seat | Kind | What lands there |
| --- | --- | --- |
| `sidebar.right.pane.tab` | keyed, session | the tab body |
| `sidebar.right.pane.tab.title` | keyed, session | the chip text and glyph |

The conversation header carries no entry for this tab: the column's own tab strip and the guide capsule already open it, and a third place to click was only crowding that row.

The tab type is registered with `ctx.sidebarRightTabs.register` and opened with `ctx.sidebarRight.openTabIn`. Its kind is `browser-view`, deliberately **not** `browser`: the shipped `@deepseek-ai/dsh-client-ui-sidebar-browser` owns that kind, and a second registration in the extension band takes a kind over, which would shadow the shipped tab out of existence.

The single-occupant `rightbar` / `rightbar.session` seats are still not touched: they belong to the column itself, not to the tabs inside it.

## Configuration

Both fields are volatile, so the host generates this plugin's settings form from them and a change reaches the running plugin without a restart. They also appear as the **Real browser** card under **Web Extensions -> Web Plugins**, alongside the plugin row's configuration page; both surfaces edit the same values.

| Field | Default | Meaning |
| --- | --- | --- |
| `realBrowserEnabled` | `false` | Attach to a browser started with remote debugging instead of launching the dedicated Chromium |
| `cdpEndpoint` | `http://127.0.0.1:9222` | HTTP endpoint of the browser to attach to; a host that is not loopback is refused |

Turning the mode on, turning it off, and changing the endpoint all detach from the browser the plugin is talking to. An external browser and every tab in it stay exactly as they are; the next tool call connects again with the current setting. A browser the plugin launched itself is shut down as before.

The panel names the active mode and, in CDP mode, the endpoint it attached to. The panel is still only a view: input comes from the agent.

Start the browser yourself first; the endpoint needs something to answer on it.

```bat
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\chrome-cdp-profile"
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222 --user-data-dir="C:\edge-cdp-profile"
```

Sign in to the sites the agent should see inside that profile once; the plugin drives those pages instead of importing their cookies. The `--user-data-dir` flag is mandatory rather than optional, for the reason under [Known limits](#known-limits).

## Security model

- **Loopback only, in both modes**: the panel socket is fenced to loopback requests, and a CDP endpoint whose host is not loopback is refused before a connection is attempted.
- **No authentication on the CDP endpoint**: the devtools protocol has no credentials, so any process on this machine that can reach that port drives the same tabs. The mode is off by default, and a loopback endpoint is what keeps that reach local.
- **Throwaway profile in isolated mode**: Chrome runs on a fresh `--user-data-dir` under the system temp directory with a random debugging port, so no cookie, session or extension of the user's real browser is reachable.
- **Your sign-ins stay in your browser**: the plugin reads pages, not the cookie jar; nothing is copied out of the attached profile into the plugin, the isolated profile or disk.
- **Every DSH session sees every tab**: while CDP mode is on, every session on this host can enumerate, read, navigate, click and type in every tab of the attached browser, including tabs opened after it attached. The mode grants that to the host, not to one session.
- **Headless by default**: in isolated mode nothing pops up on the desktop; the tab is the only view.
- **Process lifetime**: a Chromium the plugin launched is killed when the plugin disposes; disposing or changing configuration only detaches from an external browser and closes neither the browser nor any of its tabs. A session whose CDP socket has closed is dropped on its next call and detached the same way — it never closes an external browser or its tabs — then reconnected to the configured endpoint; a reconnect that fails is reported as the connection error, and the configured source is never swapped for another one.
- **Failure is an error, not a downgrade**: an endpoint that does not answer fails the tool call with the connection error, and the plugin never falls back to the isolated browser, so the panel cannot show a browser other than the configured one.
- **Token handling**: the launch token is minted per navigation, held in memory, and never written to disk; the retry only happens on a loopback target whose document is DSH's own challenge, so no other local service is ever handed the token.

## Known limits

- The tab is a **view**. Input comes from the agent through the tools; it does not forward your mouse or keyboard.
- CDP mode lists every tab the browser has, including tabs that have nothing to do with this workspace; the panel does not filter or hide them.
- Chrome 136 and later ignore `--remote-debugging-port` for the default data directory, so the default Chrome profile cannot be attached this way: use a profile explicitly started with a non-default `--user-data-dir` ([Changes to remote debugging switches](https://developer.chrome.com/blog/remote-debugging-port)).
- A browser that was launched without the debug port, or that has since exited, produces a connection error on the tool call. The retry on the next call reconnects only to the configured endpoint; the plugin never starts a real browser in its place.
- The tab lives inside the right sidebar, so it needs that column; a layout that hides the column hides the tab.
- Frames are produced when the page changes, so a static page holds the last frame instead of streaming duplicates.
- Switching chips keeps the body mounted (`keepMounted`), so the socket survives; the frame still waits for the next change.
- The token top-up only covers the site root, because DSH answers the challenge with a 303 to `./` for `GET /` alone.
- One browser per host; tabs are isolated CDP targets, not separate profiles.
- Chrome must be installed at a standard location (or named by `CHROME_PATH`) for the isolated mode, which is the only mode that launches a browser.
- In the default isolated mode the viewport is pinned at 1280x800, so a `clip` must fall inside it: a region outside it is refused rather than scrolled into place. In real-browser mode the bound is the tab's own layout viewport.

## Install

```sh
dsh plugin --profile web add link:<this repo>/packages/dsh-browser-view
```

The plugin row is read at startup, so a DSH restart is required after installing or changing it.

## Development

```sh
pnpm --filter @linxin666/dsh-client-ui-browser-view typecheck
pnpm --filter @linxin666/dsh-client-ui-browser-view test
pnpm --filter @linxin666/dsh-client-ui-browser-view build
```
