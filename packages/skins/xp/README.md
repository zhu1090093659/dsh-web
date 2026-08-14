# @linxin666/dsh-client-ui-skin-xp

English | [中文](README.zh.md)

Windows XP (Luna) skin for the dsh web GUI. It plugs in as a client plugin: `apply()` sets the `data-dsh-xp` body attribute (the whole stylesheet's scope), renders the fixed Luna-blue title bar with the four-color window-flag mark and caption buttons (minimize / maximize / close), the classic cream status bar (就绪 / DeepSeek 在线 with the sunken CAPS/NUM/SCRL indicators 大写 数字 滚动), a green 开始 Start button in the taskbar-blue sidebar footer that opens the settings dialog, Explorer-style tree rows (light-blue hover, `#316ac5` blue selection), a Bliss-style desktop sky behind the window frame and square corners everywhere, pins the document title and injects the four-color-flag favicon. Its effect disposer retracts every write — the attribute, both bars, the Start button, the favicon, and the title unless a session title already replaced it. The stylesheet ships inside the bundle via CSS-modules auto-inject, so the loader removes it when the entry is disposed.

The skin is presentation-only: no services are injected, no cordis events are emitted, nothing reaches a model request. The dark palette (`body[data-dsh-xp][data-ds-dark-theme]`) is the Zune-style black variant, so the base theme system keeps flipping tokens underneath. Scrollbar aliases stay on the base theme, keeping the stock scrollbar contract under the skin.

## Installing (official bundle)

Prefer the family aggregate package `@linxin666/dsh-skins` — every skin at once; for this skin alone, install with `link:`:

```sh
# All skins (recommended)
dsh plugin --profile web add @linxin666/dsh-skins
# Or just this skin
dsh plugin --profile web add @linxin666/dsh-client-ui-skin-xp
# Activate: dsh-skin use xp
# From the repo (dev): dsh plugin --profile web add link:$(pwd)/packages/skins/xp
```

`$(pwd)` is your clone of the dsh-web-ui monorepo.

A local `link:` install needs built artifacts first — `lib/` is git-ignored and not committed, so run `pnpm install && pnpm -r build` in the monorepo before linking. Git installs (`dsh plugin --profile web add github:<org>/dsh-web-ui#<sha>`) build `lib/` themselves via the `prepare` script; pnpm ≥10 blocks that until you copy the printed package key into the profile's `pnpm-workspace.yaml` `allowBuilds` list and re-run.

Activate or switch with `dsh-skin use xp` (helper script `scripts/dsh-skin` in the monorepo); only one skin is active at a time.

## Requirements

The pane-level chrome (sidebar band, Explorer rows, taskbar footer, conversation/details surfaces) keys on the `data-pane` attributes the AppFrame columns carry in `ui-layout`; without them the skin still applies, minus the per-pane surfaces.

## Model Experience

None. The skin mutates only the browser DOM; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known limitations

- The loading page stays stock. The shell's boot page renders before plugin bundles exist, so the skin starts at the settled UI (the boot page still gets the window frame once the attribute is set, but its inner card keeps the modern look).
- Theme switching is skin-internal. The skin pins its own palette under both `data-ds-dark-theme` states; switching Appearance themes flips between the light Luna and dark Zune palettes, not to a non-skin look.
- The Start button only opens settings. It forwards its click to the existing settings trigger in the sidebar footer; it does not host a real start menu.
- The four-color flag is a flat approximation. The waving Windows flag is rendered as a flat 2×2 flag mark, inline SVG, not the authentic waved logo.
