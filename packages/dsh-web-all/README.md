# dsh-web-all · Official All-in-One Plugin Bundle for DeepSeek Harness (DSH) Web GUI

English | [中文](README.zh.md)

<p align="center">
  <img src="https://img.shields.io/npm/v/@linxin666/dsh-web-all?style=flat-square" alt="Version">
  &nbsp;
  <img src="https://img.shields.io/npm/dm/@linxin666/dsh-web-all?style=flat-square" alt="Downloads">
  &nbsp;
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.1--rc.2-4c6ef5?style=flat-square&amp;labelColor=454a54" alt="DSH">
  &nbsp;
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>All-in-One Plugin Bundle for DeepSeek Harness (DSH) Web GUI & Desktop Client</strong><br>
  <em>Task Board · Mobile Remote · SSH Terminal · Git Graph & Worktree · Session Archive · Usage Stats · Themes</em>
</p>

The official all-in-one aggregate plugin bundle for DeepSeek Harness (DSH) Web GUI and desktop client: install all family plugins with a single command (Task Board / Git Graph / Desktop Pet / Mobile Remote / SSH Ops / Session Archive / Skin Center / Settings / Community Plugins, as defined in `aggregate.yml`). The client compat layer is integrated directly (`src/client`) eliminating separate compat packages.

> Note (alpha branch, 2026-09-17): this branch vendors no external third-party plugins.

## What it is

- **One install, everything on**: its dependencies pull in every sub-plugin package of the family (task board, Git graph, pet, mobile remote, SSH, skins, settings, community plugins and the rest — `aggregate.yml` is the complete list), and this branch bundles no external npm plugin at all. `@mlgbnb/dsh-archive-manager` (the community archive manager: group by project, search and filter, preview conversations, restore and delete) is not bundled — its upstream build still imports the removed `@deepseek-ai/dsh-client-runtime` face.
- **Aggregation carrier**: `cordis.patch.yml` aggregates the `insert` lines of each sub-plugin plus the external plugin rows, mounted through the dsh plugin profile mechanism. External profile bundles are expanded by the generator: their patch rows become importable aggregate rows, the bundle's own harness-row patches are preserved, and an external row marked `"inactive": true` gains trailing `disabled: true` overrides so nothing mounts until you opt in.
- **Family rows mount the real packages**: each family row's `name` is the plugin's own npm package, so the official `dsh-client-modules` serves that package's browser half directly — enabling one panel downloads one panel, instead of one copy of every family UI (issue #1901: the old shape inlined 13 family clients into this package's `lib/client.js`, a single 2.9 MB file). Row ids stay `web-ui-*`, so per-row switches recorded in an existing profile keep applying, and the row's own `disabled` now decides the family at the loader — no browser-side gate is needed. Subpath row names an older profile recorded (`@linxin666/dsh-web-all/<family>`) still resolve to a compat shell export after the upgrade.
- **Compat is the optional patch layer**: the `web-ui-compat` row now only ships compatibility patches — the `data-pane` / `data-dsh-frame` semantic hooks plugins and skins rely on, the responsive contract, and the boot splash — and no family plugin code. Keep it on when you need those patches; it can be switched off per row in the plugin manager.
- **Its own icon in the plugin list**: the package ships `icon.svg` and declares it as the top-level `package.json.icon`, the display-metadata field the official Plugins list (Settings → Plugins) reads, so the installed card and detail page show the family whale in both themes instead of the default artwork. Every family package ships the same asset, so a standalone install of one shows it too. DSH 0.2.1 reads subpath metadata through exported resources instead of a nested package.json, so each aggregate family row exports `<family>/icon` plus localized `locale/*.json` metadata and shows the same icon with its `web-all/<family>` title.
- **Host-only child**: the Windows private-shell plugin (`dsh-win-bash`, row `web-ui-win-bash`) ships no browser half and carries its own platform guard into the aggregate patch, so its row is disabled on every non-Windows host and costs nothing there. It also follows the LiangShen preset's declaration: with the `liangshen` row disabled, the tool registers nothing and logs why.
- **Opt-in rows**: low-usage family plugins ship disabled by default in the aggregate (currently SSH and skill-explorer — the `inactive` list in `aggregate.yml`; liangshen stays out of it, so the LiangShen mode lever is present on a fresh install). They never load and their settings entries stay hidden until you enable the row under Settings → Plugins → Plugin manager; the standalone packages are unaffected. Bundle rows can also ship a seed config that differs from the standalone default (the `patches` list); a settings edit wins once made.
- **Per-row management**: every family plugin toggles individually — under Settings → Plugins → Plugin manager this package's row expands into a child list with one switch per family plugin, written to the profile override layer. A disabled row is skipped by the loader itself: it neither mounts nor serves its browser half to the page. A disabled child is never loaded while its code still updates with the bundle; install the standalone package when a plugin needs independent versioning (a standalone install wins over the aggregate row).

## Install

### From npm (recommended)

**DSH Web CLI (Browser)**:
```sh
dsh plugin --profile web add @linxin666/dsh-web-all@latest
# Restart dsh web
dsh web
```

**Official Desktop Client (DeepSeek Harness Desktop)**:
- Open the official desktop client and navigate to "Settings > Plugins" (or the sidebar plugins view)
- Enter `@linxin666/dsh-web-all` into the install input field and click Install
- Fully quit and restart the desktop client once installation completes

### From the repository (development)

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install && pnpm -r build
node scripts/link-profile.mjs
dsh plugin --profile web add link:$(pwd)/packages/dsh-web-all
```

Restart `dsh web` (or the official desktop client) for the plugins to take effect.

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
- Aggregate rows are namespaced `web-ui-*`, so the bundle can coexist with a standalone install of the same plugin: the loader no longer rejects the duplicate id, the host half runs once (the second source is a no-op), and the browser half is deduped by package name. Keeping both sources has no benefit; prefer one. When the bundle is the source, profile patch config rows must use the `web-ui-*` id (e.g. `web-ui-remote-web-ui` for the remote-web-ui `autoTunnel` row); standalone installs keep the plugin's own id. A bundled row's config carries the shell key `plugin` — the module the row loads — with the plugin's own fields beside it; the settings card writes that shape, and a hand-written override must keep `plugin` or the row mounts nothing.
- Dependencies on the `@deepseek-ai/*` SDK are pinned; compatibility follows the repository's release cadence.
