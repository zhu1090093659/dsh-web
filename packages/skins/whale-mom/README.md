# @linxin666/dsh-client-ui-skin-whale-mom

English | [中文](README.zh.md)

鲸鱼妈妈 (Whale Mom) is a deep-sea mother-and-calf theme for the dsh web GUI: a text-free ambience painting (a whale mother with her calf, warm cream light, gold-thread accents) sits behind fully translucent panes — the big surfaces use alpha-blended tokens whose opacity is driven by the skin-center background-occlusion slider (the `--dsw-skin-scrim` variable, so panes re-raster live as the slider moves), a scrim swaps live with the base light/dark theme, and a deep-blue / cream / gold palette is remapped onto every dsh token.

It is a hot-pluggable client plugin. `apply()` sets the `data-dsh-whale-mom` body attribute (the whole stylesheet's scope), paints the art as a fixed full-viewport backdrop (base64 data URL with a readability scrim chosen by the current theme, swapped live on `data-ds-dark-theme` changes), and injects a whale-mark favicon (inline SVG data URI, no static assets). Its effect disposer retracts all of it: the attribute, the backdrop inline styles (restoring whatever was there before), and the favicon. The stylesheet ships inside the bundle via CSS-modules auto-inject, so the loader removes it when the entry is disposed.

The skin is presentation-only: no services are injected, no cordis events are emitted, nothing reaches a model request. The dark palette (`body[data-dsh-whale-mom][data-ds-dark-theme]`) is a night-cruise take on the same ocean — a deep navy veil over the dimmed backdrop — so the base theme system keeps working underneath.

## Installing

Skins ship inside the family aggregate package `@linxin666/dsh-skins` (installing it brings every skin) and are wired by the skin manager — this package declares no `dsh.bundle` (skin.json `wiring.bundleWired: false`), so `dsh-skin use` renders the insert row into the profile's own patch:

```sh
dsh plugin --profile web add @linxin666/dsh-skins
```

Activate or switch with `dsh-skin use <id>` (helper script `scripts/dsh-skin` in the monorepo); only one skin is active at a time.

## The backdrop art

`src/client/art.ts` embeds the text-free ambience painting (1920×1080 JPEG, ~250KB) as a data URL; the README comment there shows the exact regeneration steps (re-encode with `node scripts/embed-skin-art whale-mom WHALE_MOM_ART <imagePath> 1920`). The painting is text-free so UI text never fights the background. The light scrim is a thin cool veil, the dark one a deep navy veil — both tuned so text stays readable over the brightest and darkest parts of the art.

## Translucent panes

The pane opacities are token-level (`--dsw-alias-bg-*`, `--dsw-specific-sidebar-fill`) and every base alpha rides a `var(--dsw-skin-scrim, …)` expression: the skin-center background-occlusion slider (0..1) drives all of them at once, and 0 keeps the stock scrim exactly. The sidebar's base transparency is its own variable (`--dsw-skin-sidebar-alpha`, light 0 / dark 0 by default — fully scrim-driven) so you can fine-tune it live from the console:

```js
document.body.style.setProperty('--dsw-skin-sidebar-alpha', '0.4')
```

## Preview

Light ([preview/light.png](preview/light.png)) · Dark ([preview/dark.png](preview/dark.png))

## Requirements

The ambient translucency is token-level, so it applies regardless of pane layout. `backdrop-filter` is deliberately unused: a blurred ancestor becomes the containing block for fixed-position overlays (the settings panel would render trapped inside the sidebar column).

## Model Experience

None. The skin mutates only the browser DOM; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.