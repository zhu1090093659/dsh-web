# @linxin666/dsh-web-ui-all

[English](README.md) | 中文

DSH Web UI 全家桶聚合插件：一键安装全部功能插件（task-board / git-graph / pet / remote-web-ui / live-stats / web-ui-settings），外加皮肤全家桶（`dsh-skins`，皮肤资产内置）。compat 桥接层已并入本包（`src/client`），因此无需独立的 compat npm 包。

## 是什么

- **一次安装、全部到位**：其 dependencies 引入全部子插件包（dsh-client-ui-aionui-panel / dsh-client-ui-task-board / dsh-client-ui-git-graph / dsh-pet / dsh-remote-web-ui / dsh-live-stats / dsh-ssh / dsh-client-ui-web-ui-settings / dsh-skins）。
- **聚合载具**：`cordis.patch.yml` 汇总各子插件的 `insert` 行，经 dsh 插件 profile 机制挂载。

## 安装

### 从 npm 安装（推荐）

```sh
dsh plugin --profile web add @linxin666/dsh-web-ui-all
```

### 从仓库安装（开发调试）

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
node scripts/link-profile.mjs
dsh plugin --profile web add link:$(pwd)/packages/dsh-web-ui-all
```

安装后重启 `dsh web` 使插件生效。

### 手工升级

在 profile 的 `package.json` 中改版本后执行 `pnpm install`，顶层 `node_modules/@linxin666/*` 条目不会总是被刷新：它们可能仍链接到旧版本的 store 目录，直到手动重建。升级后请确认这些链接已指向新版本目录（Windows 下：先 `cmd /c rmdir <链接>` 再 `cmd /c mklink /J <链接> <目标>`），然后重启 `dsh web`。

## 已知限制

- 各子插件随本包一起激活；若只需要其中一部分，请直接安装对应子插件包。
- 不要与同名独立插件包（如 @linxin666/dsh-liangshen）同时安装；切换前先 `dsh plugin remove` 移除旧的。
- 依赖的 `@deepseek-ai/*` SDK 版本已锁定，兼容性跟随本仓库的发版节奏。
