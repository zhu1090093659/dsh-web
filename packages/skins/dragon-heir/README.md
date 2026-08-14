# @linxin666/dsh-client-ui-skin-dragon-heir

龙的传人 (Dragon Heir) skin for the dsh web GUI — one skin, two paintings:
light theme rides 不屈龙魂 (Unyielding Dragon Soul — an ink dragon, vermilion
朱砂 seal), dark theme rides 万里长城 (The Great Wall — ink-blue mountains at
dusk, dawn-gold 鎏金 accents). Both artworks and both seal favicons are inline
data URLs, so the skin ships no static files.

Hot-pluggable as a client plugin in the official standalone bundle shape:
`apply()` sets the `data-dsh-dragon-heir` body attribute (the scope of the whole
stylesheet), mounts the themed dragon backdrop with a readability scrim and the
themed 龙-seal favicon — swapping art, scrim and seal live when the base theme
system flips `data-ds-dark-theme` — and its effect disposer retracts every
write, restoring any prior backdrop verbatim. The stylesheet rides the bundle's
CSS-modules auto-inject, so the loader removes it with the entry.

The skin is presentation-only: no services are injected, no cordis events are
emitted, and nothing reaches a model request.

## Installing (official bundle)

推荐先装皮肤全家桶聚合包 `@linxin666/dsh-skins` 一次到位；只装本皮肤时用下列 link 命令。

```sh
# 装全部皮肤（推荐）
dsh plugin --profile web add @linxin666/dsh-skins
# 或单独装本皮肤
dsh plugin --profile web add @linxin666/dsh-client-ui-skin-dragon-heir
# 皮肤启用：dsh-skin use dragon-heir
# 从仓库安装（开发调试）：dsh plugin --profile web add link:$(pwd)/packages/skins/dragon-heir
```

`$(pwd)` 指克隆全家桶仓库后的目录。

本地 link 安装前需先在全家桶仓库内构建产物（`lib/` 被 git 忽略、不随仓库提交）：
`pnpm install && pnpm -r build` 后再 link 安装。
通过 git 安装（`dsh plugin --profile web add github:<org>/dsh-web-ui#<sha>`）时
`prepare` 脚本自动自包含构建 `lib/`，无需单独构建；pnpm ≥10 首次安装 git 依赖需先把
pnpm 打印的包键加入相应 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 列表再重试。

皮肤启用 / 切换用 `dsh-skin use dragon-heir`（本仓库 `scripts/dsh-skin` 辅助脚本）；同一时刻只激活一个皮肤。

## Building and testing

```sh
pnpm build   # tsdown: lib/index.js + lib/client.js (self-contained preset)
pnpm test    # vitest: apply/dispose contract spec (dual-theme art swap)
```

## Publishing to the skin center

```sh
node scripts/skin-center-bundles    # re-embed this skin into skin-center's registry
pnpm --filter @linxin666/dsh-client-ui-skin-center build
node scripts/gallery-build          # refresh the gallery manifest/bundles
node scripts/capture-previews       # re-shoot preview/light.png + preview/dark.png
```

Then commit everything (lib/, preview/, regenerated registry/gallery) and open a PR.

## Artwork swap

The two artworks live in `src/client/art.ts` (`LIGHT_ART` / `DARK_ART`) as data
URLs; the original generated PNGs are kept in `artwork/` (repo source only,
not shipped in the bundle). To swap in new artwork, use the embed script — it
compresses to WebP (≈1600px wide, quality 75, ≤800 KiB) via headless Chromium
and splices the base64 straight into the constant:

```sh
node scripts/embed-skin-art dragon-heir LIGHT_ART /path/to/ink-dragon.png
node scripts/embed-skin-art dragon-heir DARK_ART /path/to/gold-dragon.png
```

Then `pnpm build`, `node scripts/capture-previews dragon-heir`, and re-run the
skin-center/gallery regeneration. The seal favicons (`LIGHT_ICON` / `DARK_ICON`)
are self-contained SVGs and never need replacing.
