# @linxin666/dsh-web-all

[English](README.md) | 中文

DSH Web UI 全家桶聚合插件：一键安装全部功能插件（task-board / git-graph / pet / remote-web-ui / web-ui-settings / skin-center / community-plugins），外加外部插件 `dsh-better-sidebar`（右侧面板）、`@morlay/better-session`（分支式会话编辑；默认关闭）以及皮肤全家桶（`dsh-skins`，皮肤资产内置）。compat 桥接层已并入本包（`src/client`），因此无需独立的 compat npm 包。

> 注（DSH 0.1.2-alpha.2）：`dsh-better-sidebar` 已随 0.18.0-alpha.0 回归聚合——alpha.2 官方移除了它依赖的 `@deepseek-ai/dsh-client-runtime` 面，故 2026-08-30 曾暂时排除，直到上游发布对齐 alpha.2 的构建（inject 名单已改用 `@deepseek-ai/dsh-client-modules`）。`@mlgbnb/dsh-archive-manager` 仍排除：其最新上游构建（1.0.7）仍 import 已移除面，保留会导致 `dsh web` 启动失败。`@morlay/better-session` 保留（默认关闭）。

## 是什么

- **一次安装、全部到位**：其 dependencies 引入全部子插件包（dsh-client-ui-task-board / dsh-client-ui-git-graph / dsh-pet / dsh-remote-web-ui / dsh-ssh / dsh-client-ui-web-ui-settings / dsh-client-ui-skin-center / dsh-client-ui-community-plugins / dsh-skins），外加外部 npm 插件 `dsh-better-sidebar`（默认右侧面板：文件资源管理器 / 编辑器 / 终端 / Git / 浏览器；alpha.2 挡位为 0.18.0-alpha.0）与 `@morlay/better-session`（分支式会话编辑：就地 edit / retry / rewind / fork，RDB 持久化；默认关闭，见[启用 better-session](#启用-better-session)）。`@mlgbnb/dsh-archive-manager`（社区归档管理：按项目分组、搜索筛选、预览对话、一键恢复与删除）在 alpha.2 挡位未内置——其上游构建仍 import 已移除的 `@deepseek-ai/dsh-client-runtime` 面。
- **聚合载具**：`cordis.patch.yml` 汇总各子插件的 `insert` 行与外部插件行，经 dsh 插件 profile 机制挂载。`@morlay/better-session` 这类外部 profile bundle 由生成器展开：其 patch 行变成可导入的聚合行，bundle 自身的 harness-row patch 原样保留；标记了 `"inactive": true` 的外部行会在产物之后统一追加 `disabled: true` 覆盖行，未主动启用前不会挂载。
- **选择性默认**：聚合行可携带与独立包默认值不同的播种配置。`@linxin666/dsh-ssh` 在本全家桶中默认关闭（多数用户使用频率低）：在 设置 → Web 插件 → SSH 中打开一次即可，开关像普通设置修改一样持久；独立包安装不受影响。
- **右侧面板**：右侧面板固定为 `dsh-better-sidebar`（旧 aionui-panel 已于 2026-08-28 彻底移除，其附带的「侧边卡片」内嵌偏好编辑器一并删除）。侧边卡片的偏好在 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 自身的设置区管理。

## 安装

### 从 npm 安装（推荐）

**DSH Web CLI（浏览器端）**：
```sh
dsh plugin --profile web add @linxin666/dsh-web-all@latest
# 重启 dsh web
dsh web
```

**DSH Desktop（桌面客户端）**：
```sh
dsh plugin --profile desktop add @linxin666/dsh-web-all@latest
# 检查是否已挂载
dsh --profile desktop --dump-config
# 完全退出并重新启动 DSH Desktop 桌面应用
```

### 从仓库安装（开发调试）

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install && pnpm -r build
node scripts/link-profile.mjs
dsh plugin --profile web add link:$(pwd)/packages/dsh-web-all
```

安装后重启 `dsh web`（或 DSH Desktop 客户端）使插件生效。

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

## 启用 better-session

`@morlay/better-session` 随本聚合包分发但**默认关闭**：生成器展开的每一行（包括它"禁用官方 jsonl 持久层"的 patch 行）都带 `disabled: true` 覆盖，未主动启用前会话存储一直走官方 jsonl 后端。npm 依赖 bits 无论是否启用都会安装。

启用的收益（来自 [morlay/better-session](https://github.com/morlay/better-session)）：

- RDB（SQLite）存储上的真·就地会话编辑：edit / retry / reroll 直接改写历史而不 fork；只有显式 fork 才派生新会话 id；活会话支持 rewind（回退）。
- 每个会话一份规范日志——反复重试不再累积陈旧子分支——并发写完整性由 SQLite 事务兜底（单写者语义）。

启用前必须接受的代价：

- 持久层迁移到 `$DSH_HOME/sessions/sessions.sqlite`。**旧 jsonl 会话不会自动迁移**；不导入的话会话列表从空白开始。
- 切换是单向的：启用后新建的会话只存在于 SQLite（jsonl 不再有新写入）。请在启用前先跑导入。
- 只要保持启用，官方 jsonl 持久化行就一直被禁用；两个宿主进程不能同时写同一个 store。

推荐路径是 设置 → Web 插件 里 **性能引擎（dsh-perf）卡片内的 Better Session 子节**（启用 better-session 本身就是会话性能治理的一部分，所以管理面直接嵌在性能卡里）：同一界面展示两个存储、确认后自动带备份迁移并即时切换托管块——除刷新页面外无需重启宿主。仓库 checkout 的命令行等价方式：

在仓库 checkout 下执行启用三步（先停 `dsh web`）：

```sh
node scripts/dsh-better-session.mjs status           # 巡检两个存储与当前开关状态
node scripts/dsh-better-session.mjs migrate --apply  # 导入旧 session.jsonl.zstd 日志（幂等、自动备份）
node scripts/dsh-better-session.mjs enable --yes     # 写入托管 profile 覆盖块，然后启动 dsh web
```

`node scripts/dsh-better-session.mjs disable` 会移除托管覆盖块，重启后回到本包出厂的关闭状态。仅通过 npm 安装的用户可在 profile patch 手工追加等价的 `disabled: false` 覆盖行（`web-ui-session-branch`、`web-ui-session-rdb`、`web-ui-conversation-message-actions`）；旧会话迁移目前需要仓库 checkout 环境。

## 已知限制

- 各子插件随本包一起激活；若只需要其中一部分，请直接安装对应子插件包。
- 聚合行 id 统一带 `web-ui-` 命名空间，本包可与同名独立插件包共存：loader 不再拒绝重复 id，host 半区只注册一次（第二个来源为空操作），浏览器半区按包名去重。两个来源并存没有额外收益，建议只保留一个。插件来自本包时，profile 里按 id 写的配置行要改用 `web-ui-` 前缀（如 remote-web-ui 的 `autoTunnel` 配置行写成 `web-ui-remote-web-ui`）；独立安装时仍用插件原 id。
- `dsh-better-sidebar@0.18.0-alpha.0` 与 `@morlay/better-session@0.0.11` 是外部 npm 依赖（均非本仓库出品），本包发版前必须先发布它们（发布顺序见 `docs/publish-prep.md`）。better-session 另有默认关闭的开关语义——取舍与启用步骤见[启用 better-session](#启用-better-session)。
- 依赖的 `@deepseek-ai/*` SDK 版本已锁定，兼容性跟随本仓库的发版节奏。
