# @linxin666/dsh-client-ui-skin-furina

English | [中文]((README.zh.md))

A Furina theme for dsh-web.

## Installation (official bundle method)

It is recommended to install the full skin bundle `@linxin666/dsh-skins` for a one‑stop setup; to install only this skin, use the following link command.

```sh
# Install all skins (recommended)
dsh plugin --profile web add @linxin666/dsh-skins
# Or install only this skin
dsh plugin --profile web add @linxin666/dsh-client-ui-skin-furina
# Enable the skin: dsh-skin use furina
# Install from repository (for development/debugging): dsh plugin --profile web add link:$(pwd)/packages/skins/furina
```

`$(pwd)` refers to the directory where the monorepo has been cloned.

Before installing via local link, you need to build the artifacts inside the monorepo (`lib/` is ignored by git and not committed):
run `pnpm install && pnpm -r build` before linking.
When installing via git (`dsh plugin --profile web add github:<org>/dsh-web#<sha>`), the
`prepare` script automatically builds `lib/` self‑containedly, so no separate build is needed;
for pnpm ≥10, when installing a git dependency for the first time, you must first add the package key printed by pnpm to the `allowBuilds` list in the corresponding profile’s `pnpm-workspace.yaml`, then retry.

To enable / switch skins, use `dsh-skin use furina` (helper script in `scripts/dsh-skin`); only one skin can be active at a time.

## Background image

`src/client/art.ts` embeds the theme’s `background.jpg` (2278×1280) as a data URL compressed to 1920×1079 JPEG q76 (approx. 210KB); the file header comment contains the exact regeneration steps. The light overlay is an ice veil, and the dark overlay is a deep indigo veil – both are tuned to the brightest/darkest areas of the image to ensure text readability.

## Preview

Light ([preview/light.png](preview/light.png)) · Dark ([preview/dark.png](preview/dark.png)) – screenshots taken on the baseline 0807 bare‑web profile.

## Requirements

Environment translucency is token‑level (`--dsw-alias-bg-*`, `--dsw-specific-sidebar-fill`) and independent of panel layout. `backdrop-filter` is deliberately avoided: a blurred ancestor would become the containing block for fixed overlays (the settings panel would be locked inside the sidebar).

## Model experience

None. This skin only modifies the browser DOM and does not touch model requests.

#### KV Cache impact

None; this package does not assemble or send any provider requests.

## Copyright Notice

Some of the background images and decorative materials used in this theme are collected from public sources on the internet; all copyrights (including but not limited to authorship and portrait rights) remain with their respective original owners, and we use them solely for reasonable display purposes. If you believe that any material infringes upon your legitimate rights, please submit valid proof of ownership and infringement materials to us via the contact information below. We commit to verifying your claim within 3 business days and taking necessary actions such as removing, blocking, or replacing the content or disconnecting the link. Due to the complexity of online information, if we are unable to trace the original author, we sincerely apologize, and we welcome rights holders to contact us proactively so that we can properly attribute sources or discuss licensing. Contact email: `gino0922@163.com`.This notice takes effect from the date of publication, and we reserve the right of final interpretation.
