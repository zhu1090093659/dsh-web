# @linxin666/dsh-web-all

English | [中文](README.zh.md)

The one-click aggregate package for the whole dsh web UI family: installing it brings every functional plugin (task-board / git-graph / pet / remote-web-ui / web-ui-settings / skin-center / community-plugins) plus the external plugins `dsh-better-sidebar` (right panel), `@morlay/better-session` (branching session editing; ships inactive by default) and the skin family (`dsh-skins`, skin assets bundled inside). The compat bridge layer is folded into this package (`src/client`), so no separate compat npm package is needed.

> Note (DSH 0.1.2-alpha.2): `dsh-better-sidebar` is back in the aggregate at 0.18.0-alpha.0 — the alpha.2 cohort removed the `@deepseek-ai/dsh-client-runtime` face it imported, so it was tentatively excluded on 2026-08-30 until upstream shipped this alpha.2-aligned build (inject list now names `@deepseek-ai/dsh-client-modules`). `@mlgbnb/dsh-archive-manager` stays excluded: its latest upstream build (1.0.7) still imports the removed face and would abort `dsh web` boot. `@morlay/better-session` stays (ships inactive).

## What it is

- **One install, everything on**: its dependencies pull in all sub-plugin packages (dsh-client-ui-task-board / dsh-client-ui-git-graph / dsh-pet / dsh-remote-web-ui / dsh-ssh / dsh-client-ui-web-ui-settings / dsh-client-ui-skin-center / dsh-client-ui-community-plugins / dsh-skins) plus the external npm plugins `dsh-better-sidebar` (the default right sidebar: explorer / editor / terminal / git / browser; 0.18.0-alpha.0 on the alpha.2 cohort) and `@morlay/better-session` (branching session editing: in-place edit / retry / rewind / fork on RDB persistence; ships inactive by default — see [Opting into better-session](#opting-into-better-session)). `@mlgbnb/dsh-archive-manager` (the community archive manager: group by project, search and filter, preview conversations, restore and delete) is not bundled on the alpha.2 cohort — its upstream build still imports the removed `@deepseek-ai/dsh-client-runtime` face.
- **Aggregation carrier**: `cordis.patch.yml` aggregates the `insert` lines of each sub-plugin plus the external plugin rows, mounted through the dsh plugin profile mechanism. External profile bundles such as `@morlay/better-session` are expanded by the generator: their patch rows become importable aggregate rows, the bundle's own harness-row patches are preserved, and an external row marked `"inactive": true` gains trailing `disabled: true` overrides so nothing mounts until you opt in.
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

## Opting into better-session

`@morlay/better-session` ships with the aggregate but stays **inactive by default**: every expanded row (including its "disable stock jsonl persistence" patch) carries a trailing `disabled: true` override, so session storage keeps running on the stock jsonl backend until you explicitly opt in. The npm bits are installed either way.

Why to enable (from [morlay/better-session](https://github.com/morlay/better-session)):

- True in-place session editing on an RDB (SQLite) store: edit / retry / reroll rewrite history without forking; only explicit forks create new session ids; live sessions support rewind.
- One canonical log per session — no stale-branch accumulation from repeated retries — with single-writer integrity enforced by SQLite transactions.

What you give up / must accept:

- Persistence moves to `$DSH_HOME/sessions/sessions.sqlite`. **Legacy jsonl sessions do not migrate automatically**; without importing, the conversation list starts empty.
- The switch is one-way per point in time: sessions created while enabled exist only in SQLite (new jsonl writes stop once enabled). Run the importer right before enabling.
- The stock jsonl persistence row stays disabled for as long as you stay opted in, and two hosts cannot write one store at the same time.

The recommended path is the **Better Session** section inside the 性能引擎 (dsh-perf) card under Settings → Web 插件 (better-session itself is session-performance governance, so its management surface nests there): it shows both stores, runs the migration with an automatic backup on confirm, and flips the managed block live — no restart needed beyond refreshing open tabs. Repository-checkout alternative:

Enablement steps from a repository checkout (`dsh web` stopped):

```sh
node scripts/dsh-better-session.mjs status           # inspect both stores and the current posture
node scripts/dsh-better-session.mjs migrate --apply  # import legacy session.jsonl.zstd logs (idempotent, auto-backup)
node scripts/dsh-better-session.mjs enable --yes     # write the managed profile overrides, then start dsh web
```

`node scripts/dsh-better-session.mjs disable` removes the managed block and returns the aggregate to its shipped inactive state on next restart. npm-only installs can append equivalent `disabled: false` overrides for `web-ui-session-branch`, `web-ui-session-rdb` and `web-ui-conversation-message-actions` in the profile patch manually; migrating existing sessions currently requires a repository checkout.

## Known limitations

- Every sub-plugin activates together. For only a subset, install that sub-plugin package directly.
- Aggregate rows are namespaced `web-ui-*`, so the bundle can coexist with a standalone install of the same plugin: the loader no longer rejects the duplicate id, the host half runs once (the second source is a no-op), and the browser half is deduped by package name. Keeping both sources has no benefit; prefer one. When the bundle is the source, profile patch config rows must use the `web-ui-*` id (e.g. `web-ui-remote-web-ui` for the remote-web-ui `autoTunnel` row); standalone installs keep the plugin's own id.
- `dsh-better-sidebar@0.18.0-alpha.0` and `@morlay/better-session@0.0.11` are external npm dependencies (not authored in this repo); they must be published before this package's release (see `docs/publish-prep.md` for the release order). better-session additionally ships inactive by default — see [Opting into better-session](#opting-into-better-session) for the trade-offs and switch.
- Dependencies on the `@deepseek-ai/*` SDK are pinned; compatibility follows the repository's release cadence.
