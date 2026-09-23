# 蓝喉蜂虎

[English](README.md) | 中文

蓝喉蜂虎（Blue-throated Bee-eater, *Merops viridis*）——为 dsh web GUI 打造的自然主题皮肤，以纯资产目录形态内置在皮肤中心包内。喉部湛蓝（#2b87d8）驱动主交互与品牌色，青绿表面呼应上体羽色，栗红（#b26a3b）只用于警告——正如蜂虎头顶的棕色羽冠；一张 CC BY-SA 4.0 授权的低飞照片铺在磨砂玻璃面板之后。

## 是什么

- **纯资产**：`skin.json`（v2 清单）+ `skin.css`（token 重映射）+
  `assets/blue-throated-bee-eater.jpg`（背景照片）+
  `assets/selected-grass.svg`（选中行草地边）+ `assets/selected-flower.svg`
  （草地花角落场景）+ 双语 README 与 NOTICE。无 package.json、无构建步骤；
  皮肤中心包是唯一加载器。
- **选中元素草地**：选中的侧栏行与标签页底缘是一片低矮草地；选中行左边框
  附近从草地长出一朵白瓣栗心小花，没骨晕染、带一片叶与一枚小花苞——
  正是蜂虎的“餐桌”。场景画在标题左侧的空置 marker 槽位区域，锚定 shell
  稳定的 `data-pane` / `treeitem` / `aria-selected` 钩子，因此绝不遮挡文字；
  皮肤目录资产不可达的场合回退为柔和的湛蓝渐变。
- **token 优先**：亮色值挂在 `:root`，暗色值挂在
  `body[data-ds-dark-theme]`；加载器把每条选择器作用域到
  `html[data-dsh-skin="blue-throated-bee-eater"]`。
- **声明式背景**：鸟类照片经 `contributes.backgroundMedia`（亮暗共用一张，
  纱幕浓度不同）铺在 shell 的背景层；Wallpaper Engine 壁纸或用户手动背景
  始终优先于它，两者皆无时皮肤依然完整。
- **磨砂玻璃**：任一背景可见期间（统一 `data-dsh-backdrop-active` 标记），
  输入区、设置、对话框、侧面板与宠物气泡切换为半透明磨砂态（背景模糊 +
  湛蓝内缘高光）；无背景时皮肤保持不透明的克制态。不支持
  `backdrop-filter` 的环境回退为更浓的半透明薄纱。
- **语义化配色**：错误 / 警告 / 成功 / 业务状态色在亮暗两态保持区分，
  填充主按钮遵循主按钮三件套契约（fill + hover + 前景）。

## 预览

```sh
pnpm market:build                              # 刷新市场产物（market/dist）
open market/dist/preview.html?skin=blue-throated-bee-eater&theme=light
node scripts/capture-previews blue-throated-bee-eater       # 重拍 preview/{light,dark}.jpg
```

## 已知限制

- 纯呈现层：只改浏览器样式，不触及模型请求。
- 插件级细节需要插件暴露皮肤中心 v2 语义属性；未暴露的插件仍享受共享
  token 调色板。
- 试穿模拟器（preview.html）不执行皮肤 hooks（本皮肤未携带）且以静态方式
  铺背景照片；磨砂玻璃在运行时或模拟器报告背景后出现。

## 许可与署名

- 皮肤代码：Apache-2.0（见 `LICENSE`）。
- 背景照片：Kriangsak Hongchumpae，Wikimedia Commons，CC BY-SA 4.0
  （已缩放并重新压缩）。完整来源链见 `NOTICE` 与 `skin.json` 的
  `license` / `noticeUrl` / `sourceUrl` / `attribution` 字段。
