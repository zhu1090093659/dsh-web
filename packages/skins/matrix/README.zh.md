# @linxin666/dsh-client-ui-skin-matrix

[English](README.md) | 中文

适用于 dsh Web GUI 的 Matrix 骇客帝国暗色皮肤，为**深夜卧室场景**设计：近黑墨绿背景 + 墨绿等宽字体 + 低透明度数字雨，护眼、不打扰家人睡觉。

## 特性

- **低亮度配色**：背景近黑墨绿 `#040805`、正文墨绿 `#7dffb3`、品牌绿 `#00e676`、强调色 `#00e676`，长时间使用不疲劳
- **强制暗色**：不跟随系统亮/暗主题（深夜场景特性）；`apply()` 设置 `data-dsh-matrix` body 属性 + 强制 `data-ds-dark-theme`，并用 MutationObserver 维持
- **完整令牌覆盖**：`--dsw-static-*` / `--dsw-alias-*` / `--aion-*` 全套设计令牌（侧栏、会话、对话框、代码块、Git 图谱泳道色、滚动条、选区）
- **数字雨是氛围**：canvas 雨层透明度 10%、20fps 限帧、`pointer-events:none` 穿透、`prefers-reduced-motion` 自动关闭、标签页隐藏暂停、DPR 上限 2
- **零依赖**：纯浏览器端 CSS + canvas，无宿主逻辑，不修改 DSH 源码；卸载时 effect disposer 撤回全部写入

## 安装（官方 bundle 方式）

```sh
# 装全部皮肤（推荐）
dsh plugin --profile web add @linxin666/dsh-skins
# 或单独装本皮肤
dsh plugin --profile web add @linxin666/dsh-client-ui-skin-matrix
# 皮肤启用：dsh-skin use matrix
# 从仓库安装（开发调试）：dsh plugin --profile web add link:$(pwd)/packages/skins/matrix
```

## 说明

- 本皮肤为**暗色 only**：`preview/light.png` 与 `preview/dark.png` 相同（强制暗色设计）。
- 皮肤只做呈现：不注入服务、不发 cordis 事件、不触及模型请求。
