# @linxin666/dsh-web-ui-all

English | [中文](README.zh.md)

The one-click aggregate package for the whole dsh web UI family: installing it brings every functional plugin (task-board / git-graph / pet / remote-web-ui / web-ui-settings / skin-center / community-plugins / aionui-panel) plus the external npm plugins `dsh-better-sidebar` and `dsh-shikitor`, and the skin family (`dsh-skins`, skin assets bundled inside). Shikitor provides a sender and workspace editor with `#` / `@` / `$` / `/` completions. The compat bridge layer is folded into this package (`src/client`), so no separate compat npm package is needed.

## What it is

- **One install, everything on**: its dependencies pull in all sub-plugin packages (dsh-client-ui-aionui-panel / dsh-client-ui-task-board / dsh-client-ui-git-graph / dsh-pet / dsh-remote-web-ui / dsh-ssh / dsh-client-ui-web-ui-settings / dsh-client-ui-skin-center / dsh-client-ui-community-plugins / dsh-skins) plus the external npm plugins `dsh-better-sidebar` (the default right sidebar: explorer / editor / terminal / git / browser) and `dsh-shikitor` (sender and workspace editor with `#` / `@` / `$` / `/` completions).
- **Aggregation carrier**: `cordis.patch.yml` aggregates the `insert` lines of each sub-plugin plus the external npm rows for `dsh-better-sidebar` and `dsh-shikitor`, mounted through the dsh plugin profile mechanism.
- **Right panel**: the right panel is always `dsh-better-sidebar` (the aionui panel can no longer be enabled). Settings → Web UI Plugins → Side Card declares the right panel comes from [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) and edits its everyday settings inline; the provider choice was removed.

## Install

### From npm (recommended)

```sh
dsh plugin --profile web add @linxin666/dsh-web-ui-all
```

### From the repository (development)

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
node scripts/link-profile.mjs
dsh plugin --profile web add link:$(pwd)/packages/dsh-web-ui-all
```

Restart `dsh web` for the plugins to take effect.

### Manual upgrade

When you upgrade by bumping the version in the profile `package.json` and running `pnpm install`, the top-level `node_modules/@linxin666/*` entries are not always refreshed: they can stay linked to the previous version's store directory until recreated. After upgrading, verify the links resolve to the new version (on Windows: `cmd /c rmdir <link>` then `cmd /c mklink /J <link> <target>`), then restart `dsh web`.

## Known limitations

- Every sub-plugin activates together. For only a subset, install that sub-plugin package directly.
- Aggregate rows are namespaced `web-ui-*`, so the bundle can coexist with a standalone install of the same plugin: the loader no longer rejects the duplicate id, the host half runs once (the second source is a no-op), and the browser half is deduped by package name. Keeping both sources has no benefit; prefer one. When the bundle is the source, profile patch config rows must use the `web-ui-*` id (e.g. `web-ui-remote-web-ui` for the remote-web-ui `autoTunnel` row); standalone installs keep the plugin's own id.
- `dsh-better-sidebar` is an external npm dependency (not authored in this repo); it must be published before this package's release (see `docs/publish-prep.md` for the release order).
- `dsh-shikitor` is an external npm dependency (not authored in this repo); its published package must remain available before this package's release.
- Dependencies on the `@deepseek-ai/*` SDK are pinned; compatibility follows the repository's release cadence.
