# @linxin666/dsh-file-drop

English | [中文](README.zh.md)

Drag a file onto the DSH Web window and the composer fills in with the file's **original path** — no need to type a deep path by hand. You add your task instruction after the path and send; the agent then reads the file straight from disk.

## Features

- **Whole-window drop listener** in the capture phase, so the GUI's own drag handlers cannot swallow the event.
- **Host-side intake**: the file uploads to `~/.dsh/dsh-file-drop/` with sanitized names and collision-safe suffixes; the agent always has a working copy.
- **Original-path resolution**, in priority order:
  1. A `file://` uri-list carried by the OS drag (validated by the host).
  2. An exact top-level filename match in `~/Downloads`, `~/Desktop`, and `~/Documents` (used only when unique).
  3. A Spotlight (`mdfind`) exact filename match across the user index — this is what recovers files in deep directories (used only when unique).
  4. Otherwise the staged copy path, annotated `(original not found; staged copy)`.
- **Fills the composer only, never sends**: the bare path is inserted; you append your task instructions before submitting.
- Non-ASCII (Chinese, spaces) filenames travel URI-encoded and are decoded host-side.

## Why the original path is not simply available

The desktop shell (DeepSeek Harness.app) renders in a sandboxed renderer (`sandbox: true`) whose preload exposes no `webUtils`, and browsers never expose drop paths at all. This plugin therefore recovers the original location through uri-list, exact-name scans, and Spotlight — the practical layers available without touching DSH or the desktop shell.

## Config

- `enabled` — master switch (default true).
- `destDir` — override the intake directory (default `~/.dsh/dsh-file-drop`).

Set via `~/.dsh/settings.yaml` under the `file-drop` settings namespace.

## Install

Recommended: install the family aggregate `@linxin666/dsh-web-ui-all` (one package installs every plugin and skin), or install this plugin standalone:

```sh
dsh plugin --profile web add @linxin666/dsh-file-drop
```

Or from the repository (development):

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-file-drop
```

Restart `dsh web` after installing; then drag a file onto the window.

## Build

```sh
cd packages/dsh-file-drop
pnpm run build      # lib/index.js (host route) + lib/client.js (browser bundle)
pnpm run typecheck
pnpm test           # vitest: sanitization, resolution, message, composer fill
```

## Data location

- Files land in `~/.dsh/dsh-file-drop/` (the working copy; the message points at the resolved original when one is found).
- The upload route is loopback-only (`/api/dsh-file-drop/upload`).

## Known limitations

- The sandboxed renderer never exposes the dropped file's original absolute path; recovery relies on uri-list, exact-name scans, and Spotlight. A file not yet indexed by Spotlight may fall back to the staged copy.
- Identical filenames resolve only when exactly one match exists; ambiguous names fall back to the staged copy.
- A staged copy always exists as the working file; the message points at the resolved original when one is found.

## Structure

```
src/index.ts      # host half: upload route registration (enabled/destDir config)
src/routes.ts     # upload route, safe names, original-path resolution (uri-list + dirs + mdfind)
src/client/index.ts  # drop listener, upload, composer fill (path only)
src/client/locales.ts # zh/en copy
src/invariant.ts  # invariant companion plugin
tests/*.spec.ts   # sanitization, resolution, message, composer-fill tests
```