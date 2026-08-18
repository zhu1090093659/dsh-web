# @linxin666/dsh-web-ui-all

[English](README.md) | 中文

DSH Web UI 全家桶聚合插件：一键安装全部功能插件（task-board / git-graph / pet / remote-web-ui / web-ui-settings / skin-center / community-plugins / aionui-panel），外加外部 npm 插件 `dsh-better-sidebar` 与 `dsh-shikitor`，以及皮肤全家桶（`dsh-skins`，皮肤资产内置）。Shikitor 提供消息发送器和工作区文件编辑器，支持 `#` / `@` / `$` / `/` 补全。compat 桥接层已并入本包（`src/client`），因此无需独立的 compat npm 包。

## 是什么

- **一次安装、全部到位**：其 dependencies 引入全部子插件包（dsh-client-ui-aionui-panel / dsh-client-ui-task-board / dsh-client-ui-git-graph / dsh-pet / dsh-remote-web-ui / dsh-ssh / dsh-client-ui-web-ui-settings / dsh-client-ui-skin-center / dsh-client-ui-community-plugins / dsh-skins），外加外部 npm 插件 `dsh-better-sidebar`（默认右侧面板：文件资源管理器 / 编辑器 / 终端 / Git / 浏览器）和 `dsh-shikitor`（消息发送器与工作区编辑器，支持 `#` / `@` / `$` / `/` 补全）。
- **聚合载具**：`cordis.patch.yml` 汇总各子插件的 `insert` 行与外部 npm 插件 `dsh-better-sidebar`、`dsh-shikitor` 的行，经 dsh 插件 profile 机制挂载。
- **右侧面板**：右侧面板固定为 `dsh-better-sidebar`（aionui-panel 已不可启用）。设置 → Web UI 插件 → 侧边卡片 声明右侧面板来自 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 并内嵌其常用设置。

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
- 聚合行 id 统一带 `web-ui-` 命名空间，本包可与同名独立插件包共存：loader 不再拒绝重复 id，host 半区只注册一次（第二个来源为空操作），浏览器半区按包名去重。两个来源并存没有额外收益，建议只保留一个。插件来自本包时，profile 里按 id 写的配置行要改用 `web-ui-` 前缀（如 remote-web-ui 的 `autoTunnel` 配置行写成 `web-ui-remote-web-ui`）；独立安装时仍用插件原 id。
- `dsh-better-sidebar` 是外部 npm 依赖（非本仓库出品），本包发版前必须先发布它（发布顺序见 `docs/publish-prep.md`）。
- `dsh-shikitor` 是外部 npm 依赖（非本仓库出品），本包发版前必须确保其 npm 包可用。
- 依赖的 `@deepseek-ai/*` SDK 版本已锁定，兼容性跟随本仓库的发版节奏。
