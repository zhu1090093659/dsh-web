# @linxin666/dsh-client-ui-skin-maid-atelier

English | [中文](README.zh.md)

A presentation-only Abyssal Maid Atelier skin for the DeepSeek Harness Web GUI, with a dual-maid palace backdrop, ornamental navy surfaces, and responsive character staging.

## What it does

- Switches between day and night palace artwork with the active light or dark theme.
- Layers two transparent maid characters around the conversation surface and moves them to safer edges after a conversation starts.
- Adds chibi sidebar and viewport ornaments, a favicon, frosted panels, and stable loading, thinking, and tool-running animations.
- Embeds all runtime artwork as data URIs in the client bundle, so activation requires no remote asset service.
- Restores every owned DOM and CSS write when the skin is deactivated or hot-switched.

## Install

Install the `@linxin666/dsh-skins` aggregate from this repository, or add this package directly from a checkout:

```sh
dsh plugin --profile web add ./packages/skins/maid-atelier
```

## Configure

Activate the skin through the in-GUI Skin Center or the repository helper:

```sh
scripts/dsh-skin use maid-atelier
scripts/dsh-skin use official
```

Only one managed skin is active at a time. The package uses the `ui-skin-maid-atelier` wiring id and scopes its styles under `body[data-dsh-maid-atelier]`.

## Artwork and license

The skin and its artwork are distributed under **CC BY-NC-SA 4.0**. Commercial use is not permitted, attribution must be retained, and adaptations must use the same license.

The complete attribution chain is recorded in [NOTICE](NOTICE):

1. **上善** — original whale-girl character design ([Pixiv](https://www.pixiv.net/users/62155430), [Bilibili](https://b23.tv/8h5L4xz)).
2. **zipzip** — maid whale-girl redesign with DeepSeek elements, based on 上善's character and generated with GPT Image 2 ([Pixiv](https://www.pixiv.net/users/18604994), [Bilibili](https://b23.tv/Pnw6nG8)).
3. **Small-tailqwq** — the DeepSeek-element artwork adaptation and this skin.

The full license text is in [LICENSE](LICENSE), and the editable artwork sources are in `assets/`.

## Development

```sh
pnpm --filter @linxin666/dsh-client-ui-skin-maid-atelier build
pnpm --filter @linxin666/dsh-client-ui-skin-maid-atelier test
```

The committed `lib/` output is generated from this directory through the repository's shared client build preset.

## Known limitations

- The CC BY-NC-SA 4.0 terms prohibit commercial use and may not match every downstream distribution policy.
- Character placement depends on stable public DOM markers and uses conservative fallbacks when a view does not expose them.
- The embedded artwork makes the client bundle substantially larger than palette-only skins.
