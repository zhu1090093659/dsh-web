# Catppuccin

[English](README.md) | 中文

把知名的 Catppuccin 配色移植为 dsh 皮肤——柔和、平铺、纯色的主题，亮色使用
Latte 调色板，暗色使用 Mocha 调色板，以纯资产目录形态内置在皮肤中心包内。
低饱和度配色与纯色面板让它适合长时间阅读。

## 是什么

- **纯资产**：`skin.json`（v2 清单）+ `skin.css`（完整的 `--dsw-alias-*`
  token 重映射）+ `patches.css`（少量自由选择器微调）。无 package.json、
  无构建步骤；皮肤中心包是唯一加载器。
- **token 优先**：亮色值挂在 `:root`（Latte），暗色值挂在
  `body[data-ds-dark-theme]`（Mocha）；加载器把每条选择器作用域到
  `html[data-dsh-skin="catppuccin"]`。
- **双调色板**：浅色主题使用 Catppuccin Latte 调色板，深色主题使用 Catppuccin
  Mocha 调色板，两种模式下文字都不会与颜色冲突。
- **纯色面板**：每个窗格与面板都是纯 Catppuccin 色，而不是渐变或图片，保持
  对比可预测、界面宁静。

## 调色板

- 浅色（Latte）：淡紫底色 `#eff1f5`、外壳文字 `#4c4f69`、淡紫强调 `#8839ef`。
- 暗色（Mocha）：底色 `#1e1e2e`、文字 `#cdd6f4`、淡紫强调 `#cba6f7`。

## 预览

```sh
pnpm market:build                            # 刷新市场产物（market/dist）
open market/dist/preview.html?skin=catppuccin&theme=light
node scripts/capture-previews catppuccin       # 重拍 preview/{light,dark}.jpg
```

## 已知限制

- 纯呈现层：只改浏览器样式，不触及模型请求。
- 无背景图的平铺观感：本主题刻意不使用背景插画（它是纯色调色板，而非美术皮肤）。
