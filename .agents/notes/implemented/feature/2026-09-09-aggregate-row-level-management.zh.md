# Agent Note: 聚合行级插件管理

Status: implemented

## Problem

通过 `@linxin666/dsh-web-all` 全家桶安装后，十九个插件塌缩成一个管理单元：插件管理器按 profile 依赖列行，启停开关给聚合 bundle patch 声明的全部 entry id 一并写 `disabled` 覆盖行，任何家族插件都无法单独启停。这违背了「一切皆插件、插件热插拔」的设计理念，而全家桶又是多数用户的安装路径。loader 从来不是瓶颈——`applyEntryPatches` 原生认读按 id 定向的 `disabled` 覆盖，web profile 的用户 patch 层热生效——粒度是在管理器的按依赖列表与按包写入里丢掉的。

## Decision

插件管理器在网关模式下按行管理聚合内容：包行变为一组可单独启停的 entry 行。

wire 形状（`src/core/protocol.ts`）：`InstalledPluginItem` 新增可选 `children` 数组（每个声明行 `{ id, name, enabled, locked? }`）。字段纯增量，官方通道 wire 里没有它，因此官方模式行为构造上不变——只有网关提供 children 时才出现子行 UI。

宿主列表（`src/host/state.ts`）：`buildPluginRow` 在已装包的 bundle patch 声明多于一条 insert 行时输出 `children`。子行显示名优先取真实插件包名（聚合 shell 行的 `config.plugin`，由 `insertRowsOf` 新解析），其次才用按家族的子路径名。`LOCKED_ENTRY_IDS` 里的行（管理器 Tab 自身、家族设置面、聚合 compat 面——独立与聚合两种拼写）带 `locked: true`。

行级写入（`src/host/routes.ts` set-enabled）：`id` 先按 profile 依赖名解析（整包开关，语义不变）；否则 `findRowOwner` 定位声明该 entry id 的依赖，只给该行写 `{ id, name, disabled }` 用户层覆盖——与官方桌面写入器同款的按 id 定向、后写赢语义。停用锁定行直接报错拒绝；整包停用仍强制保留锁定行，GUI 逃生门不可能被自己的手关掉。响应携带刷新后的属主包行（含 children），Tab 按返回行 id 更新状态。

Tab（`src/client/PluginManagerTab.tsx`）：带子行的包行渲染缩进子列表——每个子行独立开关与状态标签，锁定行显示「核心行」提示替代开关。子行部分开启的父行显示既有「部分开启」标签；父开关在部分开启时点击为全部开启。子列表下一行提示语义：子插件可单独启停，停用后不再加载，代码仍随全家桶更新。

卸载保持整包粒度：子插件代码物理上在聚合 npm 包内，单独物理卸载构造上不可能；停用即运行时等价物（不再加载），需要独立版本管理时走独立包安装（经 boot entries 双挂载保护优先于聚合行）。

被停用行的 UI 入口门控是配套机制：[家族行状态路由](2026-09-05-family-row-state-route.zh.md)。

## Alternatives considered

- 把聚合包改造为元安装器（首启动时把每个家族包装成顶层 profile 依赖）：最纯粹的「一切皆插件」形态，但给首次启动引入联网与 pnpm 副作用（离线直接装不上）、聚合版本与子包脱钩、卸载留下孤儿，「一键安装」的故障面成倍放大。否决；行级管理不动这些就达到同样的用户可见粒度。
- 等官方安装器支持行级管理：官方清单已能逐行渲染 `web-all/<family>` 标题，上游行级控制可能到来。不作为主计划（路线图不可控），但此处使用的行 id 空间正是 loader 的 id 空间，官方写入器接手时无需迁移。
- 逐行卸载（从聚合包 node_modules 删文件）：破坏同一包内其他所有行，且下一次升级即还原。从不成立。

## Consequences

- 仅网关模式：官方通道协议没有 children 概念，官方运行时渲染与此前一致的整包行。双通道纪律保持——官方 RPC 不会被要求携带行 id。
- profile patch 文件每停用一行多一条裸覆盖行；重新启用即移除，无残留。
- 锁定行保护在宿主强制（不只 UI 隐藏）：直接打网关 HTTP 也会收到 404 与解释性错误。
- 验证：`pnpm --filter @linxin666/dsh-client-ui-plugin-manager test`（196 个测试，含行级开关/兄弟行隔离、锁定行拒绝、insert 格式行就地编辑、wire 解析与 Tab 渲染），typecheck、build、`pnpm i18n:check`（zh/en/ru 键集齐平）全绿。

## Testing

- `tests/set-enabled.spec.ts`：行级开关只写目标行、重新启用只移除该行覆盖、锁定行拒绝停用且不动 patch、未知行 id 404 不写入、insert 格式行就地编辑。
- `tests/protocol.spec.ts`：children 含 locked 标志解析；畸形 children 报出行与子行索引。
- `tests/PluginManagerTab.spec.tsx`：子行渲染开关与锁定提示、父行部分开启标签、子行开关以 entry id 调用 setEnabled 并按返回的父行刷新。
