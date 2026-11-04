# dsh-update · DeepSeek Harness (DSH) 插件生态版本检查与自动更新提醒

[English](README.md) | 中文

<p align="center">
  <img src="https://img.shields.io/npm/v/@linxin666/dsh-update?style=flat-square" alt="Version">
  &nbsp;
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.2--rc.1-4c6ef5?style=flat-square&amp;labelColor=454a54" alt="DSH">
  &nbsp;
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>DeepSeek Harness（DSH）官方 Web GUI 与桌面客户端插件版本检查与一键更新套件</strong><br>
  <em>侧边栏底栏下载按钮 · npm 自动探测 · 聚合包与独立包更新 · Release 说明拉取 · 重启生效提醒</em>
</p>

> dsh web GUI 家族自更新插件：侧边栏设置席位旁的下载触发器，探测 npm 上更新的 `@linxin666/dsh-web-*` 版本，并在当前 profile 内执行 `pnpm update --latest`。

> **全家桶不包含本包。** `@linxin666/dsh-web-all` 不挂载更新行，也不依赖 `@linxin666/dsh-update`；需要自更新的 profile 单独安装本包。聚合包只保留 `update` 的 tombstone 子路径，因此仍记录 `@linxin666/dsh-web-all/update` 的 profile 也能解析该导出，只是不挂载任何东西。

本仓库是 DeepSeek Harness（DSH）的外部插件包，双半区结构：host 半区挂载 `/api/update` 路由族，browser 半区渲染侧边栏触发器与更新面板。

该能力刻意做成**独立插件行**（行 id `update`），而不是 `dsh-remote-web-ui` 的一个席位：关闭远程访问、甚至整体禁用远程访问插件，都不应该把更新入口一起带走；该行只属于本包。

## 功能

- **侧边栏触发器**：官方 `sidebar.footer.action` 席位里、设置触发器旁边的下载按钮。
  有新版本时按钮显示文字角标；点开即探测 registry，并在结果页让用户确认更新。
- **只在网页页面挂载**：由 Web 传输交付的页面（浏览器里的回环 GUI、局域网或隧道
  部署）才显示该触发器。官方 DSH 桌面外壳的页面来自 `dsh-app://app/`，且桌面应用
  自带更新器，因此那里完全不挂载该席位——该页面的席位只留给手机远程触发器。
- **带核对的安装**：run 端点在该 Web GUI 启动的 profile 内执行
  `pnpm update --latest`，随后重新读取安装版本。pnpm 11/12 的 `minimumReleaseAge`
  门禁可能静默跳过当日发布，因此只看 pnpm 退出码为 0 不会报告成功。
- **发布说明**：面板拉取对应 GitHub Release 说明，并列出本次实际变动的组件版本。
- **重启提示**：更新成功后提示重启 `dsh web`——新版本要重启才会加载。

## 环境要求

- DSH `>= 0.2.2-rc.1`。
- profile 需通过 npm 持有家族包：聚合包 `@linxin666/dsh-web-all`，或直接安装的
  家族包。家族包以本地 `link:` 方式安装的 profile 会报告为**本地开发模式**并拒绝
  更新（请改为同步本地仓库）。

## 安装

```sh
# 推荐：直接从 npm 安装
dsh plugin --profile <profile> add @linxin666/dsh-update

# 或从检出安装（开发环）
dsh plugin --profile <profile> add link:<repo>/packages/dsh-update
```

安装本包即挂载该行；卸载本包、或在插件管理里按行关闭，即可让该 profile 不再提供自更新。

## 配置

本插件不自带设置命名空间：profile 要么挂载该行、要么不挂载，插件管理里的按行开关
是唯一控制项。宿主面是固定的——下面两条回环路由——侧栏触发器始终注册进官方
`sidebar.footer.action` 席位。

## 使用

1. 打开 dsh web GUI，看侧边栏底部：下载触发器与设置触发器并排（窄栏是 36px 圆形，
   宽栏是胶囊按钮）。
2. 点击它。面板探测 registry，显示「已是最新」或新版本及其更新说明。
3. 点「开始更新」确认。面板展示 pnpm 执行过程，随后给出结果与组件版本。
4. 重启 `dsh web` 让新版本生效。

## 路由

两条路由都是宿主 web server 上的精确匹配，且只对**本机**应答：

| 路由 | 方法 | 含义 |
| --- | --- | --- |
| `/api/update/status` | GET | 探测 registry：安装模式、所属 profile、各包当前/最新版本、发布说明 |
| `/api/update/run` | POST | 在所属 profile 内执行带版本核对的 `pnpm update --latest` |

已配对的远程桌面经 `dsh-remote-web-ui` 的门控 `/remote/api` 通道访问它们，这也是
该插件的通道规则继续把 `/api/update/` 留在配对路径上的原因。

## 安全模型

- **run 端点会在本机执行真实安装。** 它被限制在 loopback 权威内，并拒绝跨站浏览器
  标记，局域网或隧道来源无法直接触发。
- **更新目标来自宿主进程自身的模块图。** 锚点 manifest 由运行中的宿主解析
  （先 `@linxin666/dsh-web-all`，缺失时回退本包），因此更新永远写入正在提供页面
  的那个 profile，而不会采用客户端给出的路径。
- **本地 link 一律拒绝**，不做改写：`link:` 规格无法从 registry 更新，静默替换会
  让用户的检出脱离。
- 面板会原样展示捕获的 pnpm 输出，其中可能包含本地路径。本插件不读取也不写入任何
  凭据。

## 已知限制

- 桌面外壳（`dsh-app://` 页面）按设计不显示更新席位：那里请使用桌面应用自带的
  更新器，或改用浏览器打开 GUI 来驱动家族更新。
- 家族包以本地 `link:` 规格安装的 profile 会报告本地开发模式，无法自更新；请改为
  同步本地检出。
- 宿主需能解析到 `pnpm`（`pnpm`、`corepack` 或 `npx`）；都不可用时面板会点名
  失败的候选命令。
- pnpm 11/12 的 `minimumReleaseAge` 门禁可能压住当日发布。更新命令每次运行都用
  `--config.minimum-release-age=0` 覆盖该门禁；键必须是 kebab-case——pnpm 12 会
  静默忽略 `--config.minimumReleaseAge=0`，而 pnpm 11 两种写法都认（#1897）。
  安装版本没有变化时，面板会说明这个键写法差异，并给出
  `minimumReleaseAgeExclude` / `minimumReleaseAge: 0` 的处置办法。
- 捕获的 pnpm 输出会原样展示，其中可能包含本地路径。
- 让脚部动作与设置触发器共用一行的宽栏布局由 `dsh-remote-web-ui` 声明。该插件被
  禁用时更新触发器回落到官方 shell 自带的堆叠脚部：依然渲染可用，只是失去共用行
  布局。

## 开发

```sh
pnpm --filter @linxin666/dsh-update typecheck
pnpm --filter @linxin666/dsh-update test
pnpm --filter @linxin666/dsh-update build
```

## 检查

聚焦门禁：`pnpm --filter @linxin666/dsh-update test`、`pnpm typecheck`、
`pnpm test:standards`，以及聚合重建后的 `pnpm libs:check`。

## 遥测

遵循 `docs/telemetry.md`：每个浏览器每个 UTC 日一次匿名安装心跳（仅包名，失败静默）。
不上报会话内容、路径或更新结果。

## 依赖说明

`@deepseek-ai/*` 是官方 SDK（类型与宿主面）；`react` / `react-dom` 是 GUI 自身的
平台模块；`@deepseek-ai/dsh-client-ui-primitives` 图标走平台模块表。
