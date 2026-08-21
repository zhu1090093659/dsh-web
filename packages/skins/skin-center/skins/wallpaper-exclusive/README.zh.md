# 壁纸专属 Wallpaper Exclusive

[English](README.md) | 中文

面向 DeepSeek Harness Web GUI 的壁纸优先皮肤。保留官方默认底座，把浮在壁纸之上的
表面——输入卡、消息气泡、代码块、行内代码、设置卡片、插件面板、技能中心与任务清单——
统一渲染为液态玻璃，让 Wallpaper Engine 的壁纸透出。皮肤内置默认壁纸
`whale-art-v2.png`，仅在未选择 Wallpaper Engine 壁纸时使用；否则 WE 壁纸即背景。

## 功能

- 壁纸优先：WE 壁纸即背景，其上不再画任何不透明层。
- 全表面液态玻璃：输入卡、用户气泡、代码块、行内代码、设置表面、插件面板、侧栏按键
  （新会话 / 任务看板 / ssh / 技能中心）与会话/工作区卡片、顶栏子代理看板、底部面板
  chrome、composer「+」/「/」菜单、技能中心面板、git-graph chip、ssh 看板 chrome、
  排队发送卡片、任务看板列与任务卡。
- 固定磨砂：除输入卡外的所有表面使用固定半透明磨砂材质；输入卡本身走 web-ui 统一设计。
- 内置默认壁纸：`whale-art-v2.png` 随皮肤打包，未选择 WE 壁纸时显示。
- 深浅双主题：亮色与暗色 GUI 模式各有一套完整 token。

## 安装

在 设置 → 皮肤中心 → 皮肤 中选择 **壁纸专属 Wallpaper Exclusive**，并在皮肤中心壁纸
面板中启用并应用一张 Wallpaper Engine 壁纸。

## 固定磨砂（适用范围）

输入卡由 web-ui 统一设计接管，本皮肤不覆盖它。其它浮于壁纸之上的表面统一使用固定半透明
磨砂材质，变量为 `--dsw-wallpaper-glass-blur` 与 `--dsw-wallpaper-glass-fill`，不受任何
滑杆驱动。

磨砂强度固定为 10px；玻璃填充不透明度是皮肤固定值 `--dsw-wallpaper-glass-fill`。

## 已知限制

- 输入卡交给 web-ui 统一设计，不在本皮肤的固定磨砂集合内。
- 磨砂基于 `backdrop-filter`；高模糊下多层玻璃叠加会有明显 GPU 开销。
- 对话区维持官方默认外观，皮肤不强制作实底或玻璃（与全局皮肤中心设计一致）。
