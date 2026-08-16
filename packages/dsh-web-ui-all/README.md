# @linxin666/dsh-web-ui-all

English | [中文](README.zh.md)

The one-click aggregate package for the whole dsh web UI family: installing it brings every functional plugin (task-board / git-graph / pet / remote-web-ui / live-stats / web-ui-settings / skin-center / community-plugins) plus the skin family (`dsh-skins`, skin assets bundled inside). The compat bridge layer is folded into this package (`src/client`), so no separate compat npm package is needed.

## What it is

- **One install, everything on**: its dependencies pull in all sub-plugin packages (dsh-client-ui-aionui-panel / dsh-client-ui-task-board / dsh-client-ui-git-graph / dsh-pet / dsh-remote-web-ui / dsh-live-stats / dsh-ssh / dsh-client-ui-web-ui-settings / dsh-client-ui-skin-center / dsh-client-ui-community-plugins / dsh-skins).
- **Aggregation carrier**: `cordis.patch.yml` aggregates the `insert` lines of each sub-plugin, mounted through the dsh plugin profile mechanism.

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

When you upgrade by bumping the version in the profile `package.json` and running `pnpm install`, the top-level `node_modules/@linxin666/*` entries are not always refreshed: they can stay linked to the previous version's store directory until recreated. After upgrading, verify the following three points, then restart `dsh web`:

1. **Links resolve to the new version**: confirm each link points at the new version's store entity (on Windows: `cmd /c rmdir <link>` then `cmd /c mklink /J <link> <target>`).
2. **Newly added sub-packages need links created**: an upgrade can introduce sub-packages that did not exist before (e.g. `dsh-client-ui-community-plugins` is new in 0.1.19) and no top-level link appears for them automatically — a missing link makes dsh crash on startup with `Cannot find package`. Compare the package list in the release notes and create a link under `node_modules/@linxin666/` for each missing sub-package (targeting the matching version entity under `.pnpm`).
3. **Skin sub-packages moved into `dsh-skins`**: since 0.1.19, `dsh-client-ui-skin-blue-fantasy` / `-harbor` / `-qq98` / `-whale-song` no longer ship as standalone package entities; their code lives under `dsh-skins`'s `skins/<name>/`. Repoint old links to `skins/<name>` inside the new `dsh-skins` entity (do not keep the previous version as the target — a stale target fails skin loading with a version mismatch).

## Known limitations

- Every sub-plugin activates together. For only a subset, install that sub-plugin package directly.
- Do not install the aggregate package alongside the standalone package of the same plugin (e.g. @linxin666/dsh-liangshen); run `dsh plugin remove` on the old package before switching.
- Dependencies on the `@deepseek-ai/*` SDK are pinned; compatibility follows the repository's release cadence.
