# @linxin666/dsh-client-ui-skin-qq98

English | [中文](README.zh.md)

QQ2008 retro skin for the dsh web GUI. It was the first skin collected in the dsh web ui family, upgraded from the original QQ98/OICQ edition to the QQ2008 crystal-blue era. It plugs in as a client plugin: `apply()` sets the `data-dsh-retro` body attribute (the whole stylesheet's scope), renders the fixed glassy-navy title bar and pale-blue status bar, pins the document title, and injects the scarf-wearing penguin favicon. Its effect disposer retracts every write — the attribute, both bars, the favicon, and the title unless a session title already replaced it. The stylesheet ships inside the bundle via CSS-modules auto-inject, so the loader removes it when the entry is disposed.

The skin is presentation-only: no services are injected, no cordis events are emitted, nothing reaches a model request. The dark palette (`body[data-dsh-retro][data-ds-dark-theme]`) is a deeper "night" take on the same crystal-blue look, so the base theme system keeps flipping tokens underneath.

## Installing (official bundle)

Prefer the family aggregate package `@linxin666/dsh-skins` — every skin at once; for this skin alone, install with `link:`:

```sh
# All skins (recommended)
dsh plugin --profile web add @linxin666/dsh-skins
# Or just this skin
dsh plugin --profile web add @linxin666/dsh-client-ui-skin-qq98
# Activate: dsh-skin use qq98
# From the repo (dev): dsh plugin --profile web add link:$(pwd)/packages/skins/qq98
```

`$(pwd)` is your clone of the dsh-web-ui monorepo.

A local `link:` install needs built artifacts first — `lib/` is git-ignored and not committed, so run `pnpm install && pnpm -r build` in the monorepo before linking. Git installs (`dsh plugin --profile web add github:<org>/dsh-web-ui#<sha>`) build `lib/` themselves via the `prepare` script; pnpm ≥10 blocks that until you copy the printed package key into the profile's `pnpm-workspace.yaml` `allowBuilds` list and re-run.

Activate or switch with `dsh-skin use qq98` (helper script `scripts/dsh-skin` in the monorepo); only one skin is active at a time.

移除该插件（连同其注入的条目）即可回到默认外观。

## Requirements

The pane-level chrome (sidebar gradient, conversation/details surfaces) keys on the `data-pane` attributes the AppFrame columns carry in `ui-layout`; without them the skin still applies, minus the per-pane surfaces.

## Model Experience

None. The skin mutates only the browser DOM; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known limitations

- The loading page stays stock. The shell's boot page renders before plugin bundles exist, so the skin starts at the settled UI (the boot page still gets the window frame once the attribute is set, but its inner card keeps the modern look).
- Theme switching is skin-internal. The skin pins its own palette under both `data-ds-dark-theme` states; switching Appearance themes flips between the light and dark retro palettes, not to a non-retro look.
