# @linxin666/dsh-client-ui-skin-whale-song

English | [中文](README.zh.md)

鲸吟 (Whale Song) is a deep-sea whale-goddess theme for the dsh web GUI, original artwork in the spirit of the「深海鲸语女神」concept: a text-free ambience painting (a blue-haired goddess with a whale pod on the left, an ice-blue constellation grid with gold-thread accents, and generous open water on the right) sits behind translucent panes (the big surfaces use alpha-blended tokens, so the art shows through), a scrim swaps live with the base light/dark theme, and an ice-blue / cyan / navy / cobalt palette with gold accents is remapped onto every dsh token.

It is a hot-pluggable client plugin. `apply()` sets the `data-dsh-whale-song` body attribute (the whole stylesheet's scope), paints the ocean art as a fixed full-viewport backdrop (base64 data URL with a readability scrim chosen by the current theme, swapped live on `data-ds-dark-theme` changes), and injects the official DeepSeek blue-whale favicon (the real deepseek.com mark, PNG data URL, no SVG). Its effect disposer retracts all of it: the attribute, the backdrop inline styles (restoring whatever was there before), and the favicon. The stylesheet ships inside the bundle via CSS-modules auto-inject, so the loader removes it when the entry is disposed.

The skin is presentation-only: no services are injected, no cordis events are emitted, nothing reaches a model request. The dark palette (`body[data-dsh-whale-song][data-ds-dark-theme]`) is a night-cruise take on the same ocean — a deep navy veil over the dimmed backdrop — so the base theme system keeps working underneath.

## Installing (official bundle)

Prefer the family aggregate package `@linxin666/dsh-skins` — every skin at once; for this skin alone, install with `link:`:

```sh
# All skins (recommended)
dsh plugin --profile web add @linxin666/dsh-skins
# Or just this skin
dsh plugin --profile web add @linxin666/dsh-client-ui-skin-whale-song
# Activate: dsh-skin use whale-song
# From the repo (dev): dsh plugin --profile web add link:$(pwd)/packages/skins/whale-song
```

`$(pwd)` is your clone of the dsh-web-ui monorepo.

A local `link:` install needs built artifacts first — `lib/` is git-ignored and not committed, so run `pnpm install && pnpm -r build` in the monorepo before linking. Git installs (`dsh plugin --profile web add github:<org>/dsh-web-ui#<sha>`) build `lib/` themselves via the `prepare` script; pnpm ≥10 blocks that until you copy the printed package key into the profile's `pnpm-workspace.yaml` `allowBuilds` list and re-run.

Activate or switch with `dsh-skin use whale-song` (helper script `scripts/dsh-skin` in the monorepo); only one skin is active at a time.

## The backdrop art

`src/client/art.ts` embeds the text-free ambience painting (1920×1080 WebP, ~150KB) as a data URL; the README comment there shows the exact regeneration steps (re-encode with `node scripts/embed-skin-art whale-song WHALE_ART <imagePath> 1920`). The poster copy of the original concept (DEEPSEEK / 鲸吟·深寻 / ARCHIVE) was regenerated away so UI text never fights the background. The light scrim is a thin ice veil, the dark one a deep navy veil — both tuned so text stays readable over the brightest and darkest parts of the art.

## Preview

Light ([preview/light.png](preview/light.png)) · Dark ([preview/dark.png](preview/dark.png)) — captured against a stock web profile on 0813.

## Requirements

The ambient translucency is token-level (`--dsw-alias-bg-*`, `--dsw-specific-sidebar-fill`), so it applies regardless of pane layout. `backdrop-filter` is deliberately unused: a blurred ancestor becomes the containing block for fixed-position overlays (the settings panel would render trapped inside the sidebar column).

## Model Experience

None. The skin mutates only the browser DOM; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.
