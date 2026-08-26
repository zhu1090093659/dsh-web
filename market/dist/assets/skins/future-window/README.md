# Skyrail Cabin

English | [中文](README.zh.md)

Skyrail Cabin is a day-and-night skin for the dsh Web GUI, framing the workspace as a quiet cabin overlooking a futuristic city.

## What it does

- Uses separate daylight and night artwork with matching ice-blue and deep-navy token palettes.
- Presents Task Board, SSH, and Skill Center as three native interactive rows over a single cat-eared fabric cushion.
- Keeps Workspace and everything below it on the stock Web UI presentation and layout.
- Ships as a pure v2 asset directory with no package, build step, executable hook, service, event, or model-request integration.

## Install

After publication, install Skyrail Cabin on demand from the DSH Market and select it in Settings > Skin Center.

For local development, copy this directory to `$DSH_HOME/skins/future-window/`, refresh the page, and select Skyrail Cabin in the Skin Center.

## Configuration

The light and dark palettes remap official L1 tokens in `skin.css`. `patches.css` is a declared high-sensitivity L3 stylesheet used for the sidebar treatment, the New Session button, the three launcher rows, responsive artwork positioning, and the decorative cushion image.

Wallpaper Engine and a user-selected manual background take priority over the skin background. Skin Center background dimming and blur controls remain available.

## Preview

The committed `preview/light.jpg` and `preview/dark.jpg` files are generated from the repository market simulator with `node scripts/capture-previews future-window`.

## Security and privacy

The skin contains CSS and local image assets only. It does not contain `hooks.mjs`, make network requests, inspect conversation text, emit events, register services, or modify model requests.

## Known limitations

- The cushion composition depends on the current sidebar structure and is intentionally disclosed as L3 styling.
- The enhanced launcher treatment appears only when the corresponding Task Board, SSH, and Skill Center entries are installed.
- The mobile composition moves the background focal point and hides the cushion when the sidebar is collapsed.

## Artwork and license

Copyright 2026 zhuqin. The skin CSS, background artwork, cushion artwork, and preview images are distributed under the Apache License 2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE).
