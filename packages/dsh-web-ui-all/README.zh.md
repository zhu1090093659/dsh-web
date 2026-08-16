# @linxin666/dsh-web-ui-all

[English](README.md) | 中文

DSH Web UI 全家桶聚合插件：一键安装全部功能插件（task-board / git-graph / pet / remote-web-ui / live-stats / web-ui-settings / skin-center / community-plugins），外加皮肤全家桶（`dsh-skins`，皮肤资产内置）。compat 桥接层已并入本包（`src/client`），因此无需独立的 compat npm 包。

## 是什么

- **一次安装、全部到位**：其 dependencies 引入全部子插件包（dsh-client-ui-aionui-panel / dsh-client-ui-task-board / dsh-client-ui-git-graph / dsh-pet / dsh-remote-web-ui / dsh-live-stats / dsh-ssh / dsh-client-ui-web-ui-settings / dsh-client-ui-skin-center / dsh-client-ui-community-plugins / dsh-skins）。
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

在 profile 的 `package.json` 中改版本后执行 `pnpm install`，顶层 `node_modules/@linxin666/*` 条目不会总是被刷新：它们可能仍链接到旧版本的 store 目录，直到手动重建。升级后请按以下三步核对，再重启 `dsh web`：

1. **确认链接指向新版本目录**（Windows 下：先 `cmd /c rmdir <链接>` 再 `cmd /c mklink /J <链接> <目标>`）。
2. **新引入的子包需要新建链接**：升级可能引入此前没有的子包（例如 0.1.19 新增 `dsh-client-ui-community-plugins`），顶层不会自动出现它的链接——缺失时 dsh 启动即报 `Cannot find package`。请对照发布说明中的包清单，在 `node_modules/@linxin666/` 下为每个缺失的子包新建链接（指向 `.pnpm` 中对应版本实体）。
3. **皮肤子包已并入 `dsh-skins`**：自 0.1.19 起 `dsh-client-ui-skin-blue-fantasy` / `-harbor` / `-qq98` / `-whale-song` 不再有独立包实体，代码位于 `dsh-skins` 的 `skins/<name>/`。升级后请把旧链接 repoint 到 `dsh-skins` 新版本实体的 `skins/<name>` 目录（不要保留旧版本目标，否则皮肤加载会因版本错位失败）。

## 已知限制

- 各子插件随本包一起激活；若只需要其中一部分，请直接安装对应子插件包。
- 不要与同名独立插件包（如 @linxin666/dsh-liangshen）同时安装；切换前先 `dsh plugin remove` 移除旧的。
- 依赖的 `@deepseek-ai/*` SDK 版本已锁定，兼容性跟随本仓库的发版节奏。
