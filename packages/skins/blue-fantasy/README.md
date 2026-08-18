# @linxin666/dsh-client-ui-skin-blue-fantasy

English | [中文](README.zh.md)

蓝色幻想 (Blue Fantasy) is the DreamSkin「DeepSeek-鲸鱼娘」Codex desktop theme (MIT, author powerdog996) ported to the dsh web GUI. The whale-art backdrop sits behind translucent panes (the big surfaces use alpha-blended tokens, so the art shows through), a scrim swaps live with the base light/dark theme, and a periwinkle-indigo palette is remapped onto every dsh token.

It is a hot-pluggable client plugin. `apply()` sets the `data-dsh-blue-fantasy` body attribute (the whole stylesheet's scope), paints the whale art as a fixed full-viewport backdrop (base64 data URL with a readability scrim chosen by the current theme, swapped live on `data-ds-dark-theme` changes), and injects the official DeepSeek blue-whale favicon (the real deepseek.com mark, PNG data URL, no SVG). Its effect disposer retracts all of it: the attribute, the backdrop inline styles (restoring whatever was there before), and the favicon. The stylesheet ships inside the bundle via CSS-modules auto-inject, so the loader removes it when the entry is disposed.

The skin is presentation-only: no services are injected, no cordis events are emitted, nothing reaches a model request. The dark palette (`body[data-dsh-blue-fantasy][data-ds-dark-theme]`) is a night-whale take on the same art — a deep indigo veil over the dimmed backdrop — so the base theme system keeps working underneath.

## Installing

Skins ship inside the family aggregate package `@linxin666/dsh-skins` (installing it brings every skin) and are wired by the skin manager — this package declares no `dsh.bundle` (skin.json `wiring.bundleWired: false`), so `dsh-skin use` renders the insert row into the profile's own patch:

```sh
dsh plugin --profile web add @linxin666/dsh-skins
```

Activate or switch with `dsh-skin use blue-fantasy` (helper script `scripts/dsh-skin` in the monorepo); only one skin is active at a time.

## The backdrop art

`src/client/art.ts` embeds the theme's `background.jpg` (2278×1280) compressed to 1920×1079 JPEG q76 (~210KB) as a data URL; the README comment there shows the exact regeneration steps. The light scrim is an ice veil, the dark one a deep indigo veil — both tuned so text stays readable over the brightest and darkest parts of the art.

## Preview

Light ([preview/light.png](preview/light.png)) · Dark ([preview/dark.png](preview/dark.png)) — captured against a stock web profile on 0807.

## Requirements

The ambient translucency is token-level (`--dsw-alias-bg-*`, `--dsw-specific-sidebar-fill`), so it applies regardless of pane layout. `backdrop-filter` is deliberately unused: a blurred ancestor becomes the containing block for fixed-position overlays (the settings panel would render trapped inside the sidebar column).

## Model Experience

None. The skin mutates only the browser DOM; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.
