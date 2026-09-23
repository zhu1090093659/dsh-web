# 无人岛生活

[English](README.md) | 中文

致敬「动森」氛围的原创海岛皮肤：浅色模式是阳光海滩，深色模式是同一构图的星空夜景。
奶油米白面板、暖棕文字、薄荷青绿主色，按钮与输入卡带游戏按键式的立体底影，以纯资产目录形态收录进皮肤中心。

## 是什么

- **纯资产**：`skin.json`（v2 清单）+ `skin.css`（`--dsw-alias-*` token 重映射）+ `patches.css`（组件造型）+ `assets/`。无 package.json、无构建步骤、无 hooks。
- **日夜双背景**：浅色用白天海滩插画，深色用同构图的星空夜景（窗灯、萤火虫、月光海面），各自带随主题切换的遮罩，保证正文可读。
- **token 优先**：亮色值挂在 `:root`，暗色值挂在 `body[data-ds-dark-theme]`；面板透明度跟随皮肤中心的「背景遮挡」滑杆。
- **手指光标选择**：侧栏工作区 / 会话行、工作区选择、Agent 预设、模型列表等弹出菜单，悬停时文字转橙色并从左侧弹入手指图标，选中项为叶绿色胶囊。
- **游戏按键**：新会话按钮、发送 / 停止按钮带实色底影，悬停上浮、按下下沉；输入卡为圆角奶油卡片，聚焦时显示黄色高亮。

## 调色板

- 浅色：面板 `#f8f8f0` / `#f7f3df`、文字 `#5a3d22`、主色 `#19c8b9`、选中叶绿 `#d8ecc6`、悬停橙 `#f59b26`。
- 暗色：面板 `#1b2038`、文字 `#f1e8d0`、主色 `#3dd4c6`、选中深绿 `#2f4a2a`、悬停橙 `#ffb85c`。

## 预览

```sh
pnpm market:build                                # 刷新市场产物（market/dist）
open market/dist/preview.html?skin=island-life&theme=light
node scripts/capture-previews island-life         # 重拍 preview/{light,dark}.jpg
```

## 已知限制

- 纯呈现层：只改浏览器样式，不触及模型请求。
- 工作区菜单的选中项与输入卡发送按钮没有语义属性，使用 `[class*=...]` 匹配，官方前端重构类名后这两处样式可能失效（其余效果不受影响）。

## 来源与版权

- 样式代码：wertyq111，随本仓库以 Apache-2.0 发布。
- 背景插画 `assets/island-day.webp`、`assets/island-night.webp`：原创 AI 生成图（gpt-image-2.5-sunburst），未使用任何第三方角色、标志或游戏素材。
- 手指光标 `assets/select-cursor.png`：wertyq111 原创。
- 「集合啦！动物森友会」是任天堂的商标；本皮肤为风格致敬，与任天堂无关联。
