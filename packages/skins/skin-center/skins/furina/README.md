# @linxin666/dsh-client-ui-skin-furina

English | [中文](README.zh.md)

A Furina theme for dsh-web.

## Installation

The skin-center plugin is the only loader: install it (or the family aggregate), then install this skin from the [Workshop](https://dsh-market.com) into `$DSH_HOME/skins/furina/` and select it in Settings → Skin Center. One skin is active at a time and the card switches without a restart.

```sh
# The loader (either one)
dsh plugin --profile web add @linxin666/dsh-client-ui-skin-center@latest
dsh plugin --profile web add @linxin666/dsh-web-all@latest
# From the repository (development): this skin lives inside the skin-center package
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/skins/skin-center
```

`$(pwd)` refers to the directory where the monorepo has been cloned.

A local `link:` install needs the monorepo artifacts built first (`lib/` is git-ignored); installing via git (`dsh plugin --profile web add github:<org>/dsh-web#<sha>`) lets the `prepare` script build `lib/` in place, and pnpm ≥10 requires the package key it prints to be added to the profile's `pnpm-workspace.yaml` `allowBuilds` list before retrying. The repository helper `dsh-skin use furina` switches skins from a terminal as well.

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
