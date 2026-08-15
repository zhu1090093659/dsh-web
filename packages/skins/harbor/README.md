# @linxin666/dsh-client-ui-skin-harbor

English | [中文](README.zh.md)

Harbor (夕港) is a dusk-harbor theme for the dsh web GUI, adapted from the original harbor skin in dsh-skins: the anime-girl twilight-harbor painting (a blue evening sky melting into sunset orange over the water, figure left of center, quiet right half) sits behind translucent panes, a readability scrim swaps live with the base light/dark theme, and a deep-navy (#141a2e family) palette with amber-orange accents (#ff9d5c / #ffb46b) is remapped onto the dsh alias token layer.

It is a hot-pluggable client plugin. `apply()` sets the `data-dsh-harbor` body attribute (the whole stylesheet's scope), paints the harbor art as a fixed full-viewport backdrop (base64 data URL with a scrim chosen by the current theme, swapped live on `data-ds-dark-theme` changes), and injects a harbor favicon (inline SVG: navy square, sunset-orange sun, dark water). Its effect disposer retracts all of it: the attribute, the backdrop inline styles (restoring whatever was there before), and the favicon. The stylesheet ships inside the bundle via CSS-modules auto-inject, so the loader removes it when the entry is disposed.

The skin is presentation-only: no services are injected, no cordis events are emitted, nothing reaches a model request. The dusk palette is the skin's identity and stays in both theme modes; only the scrim differs — a thin twilight haze in light mode and a deeper dusk veil in dark mode (`body[data-dsh-harbor][data-ds-dark-theme]`) — so the base theme system keeps working underneath.

## Installing (official bundle)

Prefer the family aggregate package `@linxin666/dsh-skins` — every skin at once; for this skin alone, install with `link:`:

```sh
# All skins (recommended)
dsh plugin --profile web add @linxin666/dsh-skins
# Or just this skin
dsh plugin --profile web add @linxin666/dsh-client-ui-skin-harbor
# Activate: dsh-skin use harbor
# From the repo (dev): dsh plugin --profile web add link:$(pwd)/packages/skins/harbor
```

`$(pwd)` is your clone of the dsh-web-ui monorepo.

A local `link:` install needs built artifacts first — `lib/` is git-ignored and not committed, so run `pnpm install && pnpm -r build` in the monorepo before linking. Git installs (`dsh plugin --profile web add github:<org>/dsh-web-ui#<sha>`) build `lib/` themselves via the `prepare` script; pnpm ≥10 blocks that until you copy the printed package key into the profile's `pnpm-workspace.yaml` `allowBuilds` list and re-run.

Activate or switch with `dsh-skin use harbor` (helper script `scripts/dsh-skin` in the monorepo); only one skin is active at a time.

## The backdrop art

`src/client/art.ts` embeds the original harbor painting (1600×900 WebP, about 83KB) as a data URL; the file header shows the exact regeneration steps (`node scripts/embed-skin-art harbor HARBOR_ART <imagePath> 1600`). The light scrim is a thin twilight haze, the dark one a deeper dusk veil — both tuned so text stays readable over the brightest sky and the darkest water.

## Preview

Light ([preview/light.png](preview/light.png)) · Dark ([preview/dark.png](preview/dark.png)) — captured against a stock web profile on 0815.

## Requirements

The ambient translucency is token-level (`--dsw-alias-bg-*`, `--dsw-specific-sidebar-fill`), so it applies regardless of pane layout. `backdrop-filter` is deliberately unused: a blurred ancestor becomes the containing block for fixed-position overlays (the settings panel would render trapped inside the sidebar column).

## Model Experience

None. The skin mutates only the browser DOM; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.
