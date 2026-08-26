# @linxin666/dsh-skin-cyber-night

[English](README.md) | 中文

赛博夜城（Cyber Night）—— dsh web GUI 的赛博朋克夜城皮肤，以纯资产目录形态
内置在皮肤中心包内。

## 是什么

- **纯资产**：`skin.json`（v2 清单）+ `skin.css`（token 重映射）+
  `patches.css`（组件级补丁）+ `assets/`（夜城背景画作、霓虹 favicon）+
  `preview/`（亮/暗截图）。无 package.json、无构建步骤；皮肤中心包是唯一加载器。
- **背景**：霓虹城市夜景通过 `contributes.backgroundMedia` 声明（亮/暗遮罩），
  由皮肤中心背景控件拥有。
- **token 优先**：亮色值挂在 `:root`，暗色值挂在 `body[data-ds-dark-theme]`；
  加载器把每条选择器作用域到 `html[data-dsh-skin="cyber-night"]`。
  青色家族替代 blue/deepseek token，品红/电紫作强调、霓虹黄作警示。
- **Hooks**：`hooks.mjs` 注入霓虹 favicon，清理时撤回。

## 预览

```sh
pnpm market:build                              # 刷新市场产物（market/dist）
open market/dist/preview.html?skin=cyber-night&theme=light
```

## 许可与素材来源

皮肤代码遵循仓库许可（BSD-3-Clause）。背景画作由作者本人使用 OpenAI GPT 生成；
依据 OpenAI 条款作者持有生成输出权利，并以此处声明将图片以
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)（公有领域）
贡献，可随皮肤自由分发。详见 `skin.json` 的 `license` / `licenseUrl` /
`attribution` 字段。
