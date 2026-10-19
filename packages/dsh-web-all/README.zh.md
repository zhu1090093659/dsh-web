# dsh-web-all · DeepSeek Harness (DSH) Web GUI 官方插件全家桶聚合包

[English](README.md) | 中文

<p align="center">
  <img src="https://img.shields.io/npm/v/@linxin666/dsh-web-all?style=flat-square" alt="Version">
  &nbsp;
  <img src="https://img.shields.io/npm/dm/@linxin666/dsh-web-all?style=flat-square" alt="Downloads">
  &nbsp;
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.1--rc.2-4c6ef5?style=flat-square&amp;labelColor=454a54" alt="DSH">
  &nbsp;
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>DeepSeek Harness（DSH）官方 Web GUI 与桌面客户端全家桶一键聚合包</strong><br>
  <em>自动化任务看板 · 手机远程控制 · SSH 终端运维 · Git 图谱与 Worktree 隔离 · 会话归档 · 用量统计 · 主题皮肤</em>
</p>

DeepSeek Harness（DSH）Web UI 与官方桌面客户端全家桶聚合插件：一键安装家族的全部功能插件（任务看板 / Git 图谱 / 桌面宠物 / 移动端远程 / SSH 运维 / 会话归档 / 皮肤中心 / 设置区 / 社区插件，完整清单以本包 `aggregate.yml` 为准）。compat 桥接层已并入本包（`src/client`），因此无需独立的 compat npm 包。

> 注（alpha 分支，2026-09-17）：本分支不内置任何外部插件。

## 是什么

- **一次安装、全部到位**：其 dependencies 引入家族的全部子插件包（任务看板 / Git 图谱 / 宠物 / 移动端远程 / SSH / 皮肤 / 设置区 / 社区插件 等，完整清单以 `aggregate.yml` 为准），且本分支不内置任何外部 npm 插件。`@mlgbnb/dsh-archive-manager`（社区归档管理：按项目分组、搜索筛选、预览对话、一键恢复与删除）未内置——其上游构建仍 import 已移除的 `@deepseek-ai/dsh-client-runtime` 面。
- **聚合载具**：`cordis.patch.yml` 汇总各子插件的 `insert` 行与外部插件行，经 dsh 插件 profile 机制挂载。外部 profile bundle 由生成器展开：其 patch 行变成可导入的聚合行，bundle 自身的 harness-row patch 原样保留；标记了 `"inactive": true` 的外部行会在产物之后统一追加 `disabled: true` 覆盖行，未主动启用前不会挂载。
- **家族行直挂真实包**：每个家族插件的行 `name` 就是它自己的 npm 包名，官方 `dsh-client-modules` 因此直接下发该包的浏览器半区——装哪个插件就只下载哪个插件的界面，不必为了一块面板承担一份整份副本（issue #1901：旧做法把 13 个家族界面内联进本包 `lib/client.js`，单文件 2.9 MB）。行 id 仍是 `web-ui-*`，老 profile 里的行级开关照样命中；行的 `disabled` 直接由 loader 决定该家族装不装，开关不再需要浏览器端二次门控。旧 profile 里记录的子路径行名（`@linxin666/dsh-web-all/<family>`）仍保留导出空壳，升级后照常解析。
- **compat 是可选补丁层**：`web-ui-compat` 行现在只提供兼容补丁——给当前 shell 打上插件与皮肤依赖的 `data-pane` / `data-dsh-frame` 语义钩子、响应式契约与启动遮罩，不含任何家族插件代码。需要这些补丁时保持开启，不需要时可以在插件管理里按行关掉。
- **插件列表里的自有图标**：本包内置 `icon.svg` 并在 `package.json` 顶层声明 `icon`——官方插件列表（设置 → 插件列表）读取的展示元信息字段，因此已安装卡片与详情页在明暗两种主题下都显示家族鲸鱼，而不是默认插画；家族每个包都带同一份素材，单独安装某一个也会显示。DSH 0.2.1 起子路径元信息经导出资源读取，因此聚合的每个家族行导出 `<family>/icon` 与本地化 `locale/*.json`，在 `web-all/<family>` 标题旁显示同一份家族图标。
- **host-only 子插件**：Windows 私有 shell 插件（`dsh-win-bash`，行 `web-ui-win-bash`）不带浏览器半区，并把它自己的平台守卫一路带进聚合 patch，因此在任何非 Windows 宿主上该行都是 disabled、不产生任何开销。它的可用性还跟随梁神预设的声明：`liangshen` 行停用时，工具不注册并如实记录原因。
- **按需开启行**：低频家族插件在聚合包中出厂默认关闭（目前是 SSH、skill-explorer，即 `aggregate.yml` 的 `inactive` 清单；liangshen 不在该清单内，梁神模式拨杆在新装环境即在位）。它们不加载、设置入口也不出现，需要时在 设置 → 插件 → 插件管理 中按行开启；独立包安装不受影响。聚合行还可携带与独立包默认值不同的播种配置（`patches` 清单），用户改动设置后以设置为准。
- **逐行管理**：每个家族插件都可单独启停——设置 → 插件 → 插件管理 中本包行展开为子插件列表，逐行开关即时写入 profile 覆盖层。停用的行由 loader 直接跳过：它既不挂载，也不再向浏览器下发自己的界面。停用即不再加载，代码仍随全家桶更新；需要独立版本管理的插件可另行安装独立包（双挂载保护下独立安装优先）。

## 安装

### 从 npm 安装（推荐）

**DSH Web CLI（浏览器端）**：
```sh
dsh plugin --profile web add @linxin666/dsh-web-all@latest
# 重启 dsh web
dsh web
```

**官方桌面客户端（DeepSeek Harness Desktop）**：
- 打开官方桌面客户端，进入“设置 → 插件”（或左侧导航栏的插件入口）
- 在插件安装输入框中输入 `@linxin666/dsh-web-all` 并确认安装
- 安装完成后完全退出并重新启动官方桌面客户端

### 从仓库安装（开发调试）

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install && pnpm -r build
node scripts/link-profile.mjs
dsh plugin --profile web add link:$(pwd)/packages/dsh-web-all
```

安装后重启 `dsh web`（或官方桌面客户端）使插件生效。

### 手工升级

在 profile 的 `package.json` 中改版本后执行 `pnpm install`，顶层 `node_modules/@linxin666/*` 条目不会总是被刷新：它们可能仍链接到旧版本的 store 目录，直到手动重建。升级后请确认这些链接已指向新版本目录（Windows 下：先 `cmd /c rmdir <链接>` 再 `cmd /c mklink /J <链接> <目标>`），然后重启 `dsh web`。

## 故障排查

### "Failed to load plugins ... keyed slot `settings.plugin.item` requires options.key"（DSH 0.1.0-rc.6+）

聚合包内置的 `dsh-client-ui-web-ui-settings` 0.1.17 及更早版本把组卡片注册进 keyed 槽 `settings.plugin.item` 时传的是 `id` 而不是必填的 `key`（其他全家桶插件此前已注册进该组的 list 槽）；DSH 0.1.0-rc.6 起在 loader entry 应用阶段直接拒绝这种注册，Web GUI 因此以 "Failed to load plugins" 启动失败。

0.1.18 起该组改为一级 `settings.section` 注册，0.2.0 已发布；`main` 上的代码与 rc.6 / rc.7 兼容。仍在报错的 profile 带的是冻结的旧安装：

1. 把 profile `package.json` 里所有 `@linxin666/*` 依赖升到 `^0.2.0`（至少 `^0.1.18`）。
2. 重装 profile 依赖（`pnpm install`），并按上文「手工升级」重建陈旧的 `node_modules/@linxin666/*` 链接。
3. 重启 `dsh web`。

参见 [issue #513](https://github.com/zhu1090093659/dsh-web/issues/513)。

## 已知限制

- 各子插件随本包一起激活；若只需要其中一部分，请直接安装对应子插件包。
- 聚合行 id 统一带 `web-ui-` 命名空间，本包可与同名独立插件包共存：loader 不再拒绝重复 id，host 半区只注册一次（第二个来源为空操作），浏览器半区按包名去重。两个来源并存没有额外收益，建议只保留一个。插件来自本包时，profile 里按 id 写的配置行要改用 `web-ui-` 前缀（如 remote-web-ui 的 `autoTunnel` 配置行写成 `web-ui-remote-web-ui`）；独立安装时仍用插件原 id。聚合行的配置里 `plugin` 是壳自己的键（该行加载哪个模块），插件自身字段与它平级；设置卡片写出的就是这一形态，手写覆盖必须保留 `plugin`，否则该行什么都不挂载。
- 依赖的 `@deepseek-ai/*` SDK 版本已锁定，兼容性跟随本仓库的发版节奏。
