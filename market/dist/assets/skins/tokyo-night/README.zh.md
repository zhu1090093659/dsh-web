# @linxin666/dsh-skin-tokyo-night

[English](README.md) | 中文

东京夜行（Tokyo Night）—— dsh web GUI 的东京夜城皮肤，以纯资产目录形态收录在
皮肤中心内，向经典开发者配色 Tokyo Night 致敬。

## 是什么

- **纯资产**：`skin.json`（v2 清单）+ `skin.css`（全量 token 重映射）+
  `patches.css`（组件级补丁）+ `assets/`（东京夜景背景画）+ `preview/`
  （亮/暗截图）。无 package.json、无构建步骤；皮肤中心包是唯一加载器。
- **背景**：动漫风东京夜景（东京塔暖橙灯火浸在深靛蓝紫夜幕里）通过
  `contributes.backgroundMedia` 声明（亮/暗遮罩），由皮肤中心背景控件拥有；
  遮罩随亮/暗主题实时切换。
- **token 优先**：亮色值挂在 `:root`（Tokyo Night Day 昼间变体），暗色值挂在
  `body[data-ds-dark-theme]`（Tokyo Night Night 经典夜调）；加载器把每条选择器
  作用域到 `html[data-dsh-skin="tokyo-night"]`。深靛蓝 `#1a1b26` 底、东京蓝
  `#7aa2f7` 主色、落日橙 `#ff9e64` 强调、品红紫作点缀，蓝紫家族替代
  blue/deepseek 全部 token。
- **无 Hooks**：不包含 `hooks.mjs`，纯声明式皮肤，无任何运行时脚本。

## 预览

```sh
pnpm market:build                              # 刷新市场产物（market/dist）
open market/dist/preview.html?skin=tokyo-night&theme=light
```

## 许可与素材来源

皮肤代码遵循仓库许可（Apache-2.0）。背景画作由贡献者使用 MiMo 图像生成创作；
贡献者持有生成输出权利，并以此处声明将图片以
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)（公有领域）
贡献，可随皮肤自由分发。详见 `skin.json` 的 `license` / `licenseUrl` /
`attribution` 字段。
