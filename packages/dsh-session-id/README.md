# @linxin666/dsh-client-ui-session-id

English | [中文](README.zh.md)

A browser-only DSH web GUI plugin that lists every session with its full
session id in a sidebar panel and copies the id on one click. It mounts into
the official sidebar footer seat (`sidebar.footer.action`) — no DSH source
changes, nothing runs on the host.

## What it does

- Adds a "Session ID" trigger beside the sidebar settings row: an icon-only
  button in both the 56px rail and the wide sidebar (the label stays as the
  accessible name and hover tooltip).
- In the rail it stacks vertically with the update/remote actions on the rail
  centerline; in the wide sidebar it sits inline with them.
- Opens a centered panel listing every session: display title, full session id
  (monospace), and a per-row "Copy" button. The current session is marked.
- A search box filters the list locally by title or id substring (read-only,
  no host query), so finding a session among hundreds stays fast.
- Sessions are read from the official `ctx.sessions.list` feed, so the panel
  stays live as sessions start, finish, or get archived — no refresh needed.
- Clicking "Copy" writes the id through the official clipboard helper
  (`writeClipboard`); the button briefly shows "Copied".

## Install

### From npm (recommended)

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-session-id@latest
```

Restart `dsh web` (or wait for the hot-reload) and click the Session ID entry
at the bottom of the sidebar.

### From the repository (development)

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install
pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-session-id
```

## Security model

- A session id is a **locator / automation identifier**, not a credential:
  it never grants access to the session, its files, or its host. The panel
  only displays and copies ids; it never writes them to the session log, the
  agent prompt, or any persistent storage, and it never copies automatically.
- Copying is always user-gesture driven; a failed clipboard write shows an
  actionable "Copy failed, retry" state with no permission request and no
  background retry.
- Sharing a session id can still **expose workflow associations** (titles,
  run times, and the session's place in the workspace), so copy ids only when
  you actually need to reference a session elsewhere.

## Known limitations

- Requires a DSH shell that declares `sidebar.footer.action` (0.1.0-rc.8 and
  newer shells). On older shells the entry does not render.
- Read-only viewer: it shows and copies ids, it does not open or manage
  sessions.

## Telemetry

The browser half sends one anonymous install heartbeat per UTC day to dsh-market.com: a random localStorage id plus this package's name, nothing else. The server stores only a salted hash of that id, never IP addresses, and exposes aggregate counts only. See [docs/telemetry.md](../../docs/telemetry.md) for the full contract.

## License

BSD-3-Clause.
