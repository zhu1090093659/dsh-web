# @linxin666/dsh-client-ui-skin-dragon-heir

[English](README.md) | 中文

龙的传人 (Dragon Heir) dsh web GUI 皮肤——一皮双画：亮色主题走 不屈龙魂（水墨龙 + 朱砂印），暗色主题走 万里长城（黄昏的墨蓝群山 + 晨曦鎏金点缀）。两幅画作与两枚印章 favicon 都是内联 data URL，因此本皮肤不附带任何静态文件。

以客户端插件方式热插拔：`apply()` 设置 `data-dsh-dragon-heir` body 属性（整张样式表的生效范围）、挂载带可读性遮罩的主题龙背景与主题 龙印 favicon——当基础主题系统翻动 `data-ds-dark-theme` 时实时切换画作、遮罩与印章——其 effect 清理器收回每一处写入，原样恢复任何先前背景。样式表随 bundle 的 CSS-modules 自动注入，loader 会随条目一并移除。

本皮肤只做呈现：不注入服务、不发 cordis 事件、不触任何模型请求。

## 安装

皮肤内置在家族聚合包 `@linxin666/dsh-skins` 里（装它 = 全部皮肤一次到位），由皮肤管理器接线——本包不声明 `dsh.bundle`（skin.json 的 `wiring.bundleWired: false`），`dsh-skin use` 会把 insert 行写进 profile 自己的 patch：

```sh
dsh plugin --profile web add @linxin666/dsh-skins
```

用 `dsh-skin use <id>`（monorepo 里的辅助脚本 `scripts/dsh-skin`）激活或切换；同一时刻只激活一款皮肤。

## 构建与测试

```sh
pnpm build   # tsdown: lib/index.js + lib/client.js (self-contained preset)
pnpm test    # vitest: apply/dispose contract spec (dual-theme art swap)
```

## 发布到皮肤中心

```sh
node scripts/skin-center-bundles    # re-embed this skin into skin-center's registry
pnpm --filter @linxin666/dsh-client-ui-skin-center build
node scripts/gallery-build          # refresh the gallery manifest/bundles
node scripts/capture-previews       # re-shoot preview/light.png + preview/dark.png
```

然后提交全部（lib/、preview/、再生成的 registry/gallery）并开 PR。

## 画作替换

两幅画作以 data URL 存在 `src/client/art.ts`（`LIGHT_ART` / `DARK_ART`）；原始生成的 PNG 保留在 `artwork/`（仅仓库源码，不随 bundle 分发）。要换入新画作，用嵌入脚本——它经无头 Chromium 压缩为 WebP（约 1600px 宽、质量 75、≤800 KiB）并把 base64 直接拼进常量：

```sh
node scripts/embed-skin-art dragon-heir LIGHT_ART /path/to/ink-dragon.png
node scripts/embed-skin-art dragon-heir DARK_ART /path/to/gold-dragon.png
```

然后 `pnpm build`、`node scripts/capture-previews dragon-heir`，并重跑 skin-center/gallery 再生成。印章 favicon（`LIGHT_ICON` / `DARK_ICON`）是自包含 SVG，永远无需替换。
