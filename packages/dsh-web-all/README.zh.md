# @linxin666/dsh-web-all

[English](README.md) | 中文

DSH Web UI 全家桶聚合插件：一键安装家族的全部功能插件（任务看板 / Git 图谱 / 宠物 / 移动端远程 / SSH / 模型能力 / 会话归档 / 皮肤 / 设置区 / 社区插件，完整清单以本包 `aggregate.yml` 为准）。compat 桥接层已并入本包（`src/client`），因此无需独立的 compat npm 包。

> 注（alpha 分支，2026-09-17）：本分支不内置任何外部右侧面板插件。`dsh-better-sidebar@0.19.1` 的全部 `@deepseek-ai/dsh-*` peer 声明为 `^0.1.5-rc.1`，本分支构建所依据的 `0.1.7-alpha.1` cohort 不满足该区间，因此它既不是依赖、也不挂行；需要右侧面板时按需安装（`dsh plugin --profile web add dsh-better-sidebar@latest`）。稳定线 `dev` 仍以 0.19.1 内置。`@mlgbnb/dsh-archive-manager` 两条线都排除：其最新上游构建（1.0.7）仍 import 已移除面，保留会导致 `dsh web` 启动失败。

## 是什么

- **一次安装、全部到位**：其 dependencies 引入家族的全部子插件包（任务看板 / Git 图谱 / 宠物 / 移动端远程 / SSH / 模型能力 / 皮肤 / 设置区 / 社区插件 等，完整清单以 `aggregate.yml` 为准），且本分支不内置任何外部 npm 插件（右侧面板改为按需安装）。`@mlgbnb/dsh-archive-manager`（社区归档管理：按项目分组、搜索筛选、预览对话、一键恢复与删除）未内置——其上游构建仍 import 已移除的 `@deepseek-ai/dsh-client-runtime` 面。
- **聚合载具**：`cordis.patch.yml` 汇总各子插件的 `insert` 行与外部插件行，经 dsh 插件 profile 机制挂载。外部 profile bundle 由生成器展开：其 patch 行变成可导入的聚合行，bundle 自身的 harness-row patch 原样保留；标记了 `"inactive": true` 的外部行会在产物之后统一追加 `disabled: true` 覆盖行，未主动启用前不会挂载。
- **故障隔离（shell 壳）**：DSH loader 把全部 patch 行作为一个事务组挂载——任何一个插件 import 或启动失败都会回滚整组并中止 `dsh web`。因此聚合包让每个家族插件都挂在永不失败的 shell 模块（本包 main 入口）之后：行 `name` 指向按家族划分的子路径导出 `@linxin666/dsh-web-all/<family>`，行 `config` 携带真插件包名。子路径即官方插件列表（设置 → 插件列表）展示的名称——每行一个独立的 `web-all/<family>` 标题（与宿主自带 `web-app/startup` 行的多条目惯例一致），而全部子路径都解析到同一个共享 shell 再导出模块，隔离语义完全不变。坏插件现在只降级自身（记录日志，并可经仅限 loopback 的健康路由 `GET /api/dsh-web-all/degraded` 查询），其余插件照常挂载。外部行（家族之外的 npm 包）仍直接挂载；`dsh-i18n` 直挂（宿主半区为空）。
- **按需开启行**：低频家族插件在聚合包中出厂默认关闭（目前是 SSH、describe-image、liangshen、skill-explorer、doctor，即 `aggregate.yml` 的 `inactive` 清单）。它们不加载、设置入口也不出现，需要时在 设置 → 插件 → 插件管理 中按行开启；独立包安装不受影响。聚合行还可携带与独立包默认值不同的播种配置（`patches` 清单），用户改动设置后以设置为准。
- **逐行管理**：每个家族插件都可单独启停——设置 → 插件 → 插件管理 中本包行展开为子插件列表，逐行开关即时写入 profile 覆盖层；宿主半经 `GET /api/dsh-web-all/rows` 告知浏览器半哪些行活跃，被停用的行连设置入口一并消失（路由不可达时失败放行、全部照常挂载）。停用即不再加载，代码仍随全家桶更新；需要独立版本管理的插件可另行安装独立包（双挂载保护下独立安装优先）。
- **右侧面板**：本分支不内置右侧面板插件。需要时按需安装 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)（`dsh plugin --profile web add dsh-better-sidebar@latest`），其偏好在它自身的设置区管理。

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

## 已知限制

- 各子插件随本包一起激活；若只需要其中一部分，请直接安装对应子插件包。
- 聚合行 id 统一带 `web-ui-` 命名空间，本包可与同名独立插件包共存：loader 不再拒绝重复 id，host 半区只注册一次（第二个来源为空操作），浏览器半区按包名去重。两个来源并存没有额外收益，建议只保留一个。插件来自本包时，profile 里按 id 写的配置行要改用 `web-ui-` 前缀（如 remote-web-ui 的 `autoTunnel` 配置行写成 `web-ui-remote-web-ui`）；独立安装时仍用插件原 id。
- 依赖的 `@deepseek-ai/*` SDK 版本已锁定，兼容性跟随本仓库的发版节奏。
