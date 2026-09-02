# @linxin666/dsh-web-all

English | [中文](README.zh.md)

The one-click aggregate package for the whole dsh web UI family: installing it brings every functional plugin (task-board / git-graph / pet / remote-web-ui / web-ui-settings / skin-center / community-plugins) plus the external plugin `dsh-better-sidebar` (right panel) and the skin family (`dsh-skins`, skin assets bundled inside). The compat bridge layer is folded into this package (`src/client`), so no separate compat npm package is needed.

> Note (DSH 0.1.2-alpha.2): `dsh-better-sidebar` is back in the aggregate at 0.18.0-alpha.0 — the alpha.2 cohort removed the `@deepseek-ai/dsh-client-runtime` face it imported, so it was tentatively excluded on 2026-08-30 until upstream shipped this alpha.2-aligned build (inject list now names `@deepseek-ai/dsh-client-modules`). `@mlgbnb/dsh-archive-manager` stays excluded: its latest upstream build (1.0.7) still imports the removed face and would abort `dsh web` boot.

## What it is

- **One install, everything on**: its dependencies pull in all sub-plugin packages (dsh-client-ui-task-board / dsh-client-ui-git-graph / dsh-pet / dsh-remote-web-ui / dsh-ssh / dsh-client-ui-web-ui-settings / dsh-client-ui-skin-center / dsh-client-ui-community-plugins / dsh-skins) plus the external npm plugins `dsh-better-sidebar` (the default right sidebar: explorer / editor / terminal / git / browser; 0.18.0-alpha.0 on the alpha.2 cohort). `@mlgbnb/dsh-archive-manager` (the community archive manager: group by project, search and filter, preview conversations, restore and delete) is not bundled on the alpha.2 cohort — its upstream build still imports the removed `@deepseek-ai/dsh-client-runtime` face.
- **Aggregation carrier**: `cordis.patch.yml` aggregates the `insert` lines of each sub-plugin plus the external plugin rows, mounted through the dsh plugin profile mechanism. External profile bundles are expanded by the generator: their patch rows become importable aggregate rows, the bundle's own harness-row patches are preserved, and an external row marked `"inactive": true` gains trailing `disabled: true` overrides so nothing mounts until you opt in.
- **Fault isolation (the shell)**: the DSH loader mounts all patch rows as one transactional group — a single plugin that fails to import or start would roll back the whole group and abort `dsh web`. The aggregate therefore mounts every family plugin behind a never-failing shell module (this package's main entry): the row `name` points at a per-family subpath export `@linxin666/dsh-web-all/<family>` and the row `config` names the real plugin package. The subpath is what the official plugin list (Settings → Plugins) displays — one distinct `web-all/<family>` title per row (the same multi-entry convention as the host's own `web-app/startup` row) — while all subpaths resolve to the same shared shell re-export, so the isolation semantics are identical. A broken plugin now degrades alone (logged, and listed by the loopback-only health route `GET /api/dsh-web-all/degraded`) while every other plugin mounts normally. External rows (npm packages outside the family) keep mounting directly; `dsh-i18n` stays direct (empty host half).
- **Selective defaults**: bundle rows can ship a seed config that differs from the standalone package's default. `@linxin666/dsh-ssh` ships disabled in the aggregate (low usage for most users): flip it on once under Settings → Web Plugins → SSH; the switch persists like any settings edit. The standalone package is unaffected.
- **Right panel**: the right panel is always `dsh-better-sidebar` (the legacy aionui panel was fully removed on 2026-08-28, together with the inline Side Card preference editor it carried). The side card's preferences live in [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)'s own settings section.

## Install

### From npm (recommended)

**DSH Web CLI (Browser)**:
```sh
dsh plugin --profile web add @linxin666/dsh-web-all@latest
# Restart dsh web
dsh web
```

**DSH Desktop (Desktop Client)**:
```sh
dsh plugin --profile desktop add @linxin666/dsh-web-all@latest
# Verify bundle mount
dsh --profile desktop --dump-config
# Fully quit and restart DSH Desktop application
```

### From the repository (development)

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install && pnpm -r build
node scripts/link-profile.mjs
dsh plugin --profile web add link:$(pwd)/packages/dsh-web-all
```

Restart `dsh web` (or DSH Desktop application) for the plugins to take effect.

### Manual upgrade

When you upgrade by bumping the version in the profile `package.json` and running `pnpm install`, the top-level `node_modules/@linxin666/*` entries are not always refreshed: they can stay linked to the previous version's store directory until recreated. After upgrading, verify the links resolve to the new version (on Windows: `cmd /c rmdir <link>` then `cmd /c mklink /J <link> <target>`), then restart `dsh web`.

## Troubleshooting

### "Failed to load plugins ... keyed slot `settings.plugin.item` requires options.key" (DSH 0.1.0-rc.6+)

Versions up to 0.1.17 of the bundled `dsh-client-ui-web-ui-settings` registered its card in the keyed `settings.plugin.item` slot with an `id` instead of the required `key` (the other family plugins already registered their cards in the group's list slot). DSH 0.1.0-rc.6 and later reject such entries while the loader entry applies, so the web GUI fails to boot with "Failed to load plugins".

The group moved to a first-level `settings.section` registration in 0.1.18 and ships in 0.2.0; the code on `main` is compatible with rc.6 and rc.7. A profile that still fails carries a frozen older install:

1. Bump every `@linxin666/*` dependency in the profile `package.json` to `^0.2.0` (at least `^0.1.18`).
2. Reinstall the profile dependencies (`pnpm install`) and recreate the stale `node_modules/@linxin666/*` links as described in Manual upgrade above.
3. Restart `dsh web`.

See [issue #513](https://github.com/zhu1090093659/dsh-web/issues/513).

## Known limitations

- Every sub-plugin activates together. For only a subset, install that sub-plugin package directly.
- Aggregate rows are namespaced `web-ui-*`, so the bundle can coexist with a standalone install of the same plugin: the loader no longer rejects the duplicate id, the host half runs once (the second source is a no-op), and the browser half is deduped by package name. Keeping both sources has no benefit; prefer one. When the bundle is the source, profile patch config rows must use the `web-ui-*` id (e.g. `web-ui-remote-web-ui` for the remote-web-ui `autoTunnel` row); standalone installs keep the plugin's own id.
- `dsh-better-sidebar@0.18.0-alpha.0` is an external npm dependency (not authored in this repo); it must be published before this package's release (see `docs/publish-prep.md` for the release order).
- Dependencies on the `@deepseek-ai/*` SDK are pinned; compatibility follows the repository's release cadence.
