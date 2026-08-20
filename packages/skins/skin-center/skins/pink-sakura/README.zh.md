# Pink Sakura

[English](README.md) | 中文

粉樱是一款克制的奶油粉开发者主题，以纯资产目录形态内置在 dsh web GUI
皮肤中心包内。

## 是什么

- **纯资产**：`skin.json`（v2 清单）+ `skin.css`（token 重映射）。
  无 package.json、无构建步骤；皮肤中心包是唯一加载器。
- **token 优先**：亮色值挂在 `:root`，暗色值挂在
  `body[data-ds-dark-theme]`；加载器把每条选择器作用域到
  `html[data-dsh-skin="pink-sakura"]`。
- **插件覆盖**：使用稳定语义属性适配任务看板、Git 图谱、SSH、设置卡、社区插件市场与鲸鱼娘气泡。
- **壁纸兼容**：内置 Wallpaper Engine 桥接启用时，面板自动转为半透明，但不携带或再分发任何壁纸资源。

## 预览

```sh
node scripts/gallery-build                   # 注册进 gallery/manifest.js + styles.js
open gallery/preview.html?skin=pink-sakura&theme=light
node scripts/capture-previews pink-sakura       # 重拍 preview/{light,dark}.png
```

## 已知限制

- 纯呈现层：只改浏览器样式，不触及模型请求。
- 插件需要输出皮肤中心 v1 语义属性才能获得专属细节；其他插件仍会继承共享 token 配色。
