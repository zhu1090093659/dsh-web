# @linxin666/dsh-client-ui-skin-furina

English | [中文](README.zh.md)

Furina themed blue accented skin for the dsh web GUI.

Hot-pluggable as a client plugin in the official standalone bundle shape:
`apply()` sets the `data-dsh-furina` body attribute (the scope of the whole
stylesheet), renders the chrome, and pins the document title; its effect
disposer retracts every write. The stylesheet rides the bundle's CSS-modules
auto-inject, so the loader removes it with the entry.

The skin is presentation-only: no services are injected, no cordis events are
emitted, and nothing reaches a model request.

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
