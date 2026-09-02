# Agent Note: Doctor 启动自愈按归因隔离涉事插件

Status: implemented

## Problem

聚合 shell（见 [aggregate-plugin-fault-isolation-shell](../../architecture/2026-09-01-aggregate-plugin-fault-isolation-shell.md)）把单个插件的启动失败包含在了家族内部，但 shell 覆盖不到的失败——坏掉的外部插件、宿主级故障、手改坏的 profile patch——仍会炸掉启动，恢复全靠手工：读启动报错、推断是哪一行坏了、手工编辑 `cordis.patch.yml`。doctor Supervisor 其实一直在盯启动（launcher 上报的 `launcher-exit` 携带 32 KiB 的 stderr 尾巴和 `started` 标志），也有按 profile 的失败计数和 2 次熔断，但闭环里没有任何环节把故障映射到插件行或禁用一行。

## Decision

Supervisor 现在以插件粒度闭环，开关挂在 `autoRepair`（默认关，与修复提升同一开关）之下：

- **归因**（`packages/dsh-doctor/src/core/boot-attribution.ts`，纯函数）：用宿主真实的报错形状（对照 `@deepseek-ai/dsh-app-boot` 0.1.2-alpha.3 实证）把捕获的 stderr 匹配到 profile 自己的 patch 行：`failed to apply|import loader entry <id> (...)`——包括 include 包裹子行、同一行嵌套两层的形态——加上 `plugin(s) failed to load: <ids>` 审计清单，以及按行名匹配的逐条激活失败行。只认正向匹配；报错里没有本 profile 拥有的行就不归因。
- **隔离写入**（`packages/dsh-doctor/src/core/plugin-quarantine.ts`）：向 profile 的 `cordis.patch.yml` 追加一行 `- id: <rowId>` + `disabled: true` 覆盖，带时间戳标记注释——这正是 loader 持久化自毁插件时用的 bare-row 合并语义。幂等（已有覆盖则返回 `already`），拒绝禁用 profile 不拥有的行，拒绝空文件和解析失败的 patch 文件（那是 D-040 线的职责），其余行保持逐字节不变。
- **Supervisor 挂接**（`src/agent/supervisor.ts`）：`launcher-exit` 在启动前失败（`started: false`、非零、非主动）且 `fullProtection` + `autoRepair` 开启、profile 未暂停时：窗口内第一次失败只观察（用户可能正在手改 patch，不能一击就禁用）；第二次归因并自愈。无法归因的失败只在事件里标注 `could not be attributed`，绝不禁用；每次自愈都进 journal 与事件证据。

启动后才崩溃（`started: true`）从不走自愈——那是进程问题不是插件行问题，归既有的 process-crash 事件管。

## Alternatives considered

第一次失败就动手被否决：暂态（用户正在编辑 `cordis.patch.yml`）会把健康插件禁掉。按插件 NAME 经 composed dump 禁用被否决：审计行写的是 name，但 name 不是行 id 那样的唯一属主键，解析不到属主行的 name 只会静默无效。经完整修复事务（`createCandidateTransaction`）写入被否决：这个覆盖是带解析门与幂等性的两行追加，比快照-暂存-门禁-提升的流水线轻得多，且复用的正是 loader 给自毁插件准备的持久化机制。等待上游提案（行级 `continueOnError`，现为 [deepseek-harness discussion #5335](https://github.com/deepseek-ai/deepseek-harness/discussions/5335)）仍是平台层的长期解；自愈是那之前对持续失败的行的恢复网。

## Consequences

可归因到行的启动失败，恢复窗口从"用户读日志手工改 YAML"缩短到"重启一次 `dsh web`"。已知代价：自愈的行保持禁用，直到用户（或未来的确认流）重新启用——这是设计使然，静默恢复会重新引入启动循环。`autoRepair: false` 的部署保持今天的行为。归因解析器与宿主报错措辞耦合；宿主改了报错格式时归因退化为"无匹配"（安全方向——不禁用），报错原文留在事件证据里可再核对。

## Testing

`packages/dsh-doctor/tests/core-boot-attribution.spec.ts`（7）：四种消息形状、同一行嵌套形态、未知行、噪声、非属主行。`tests/core-plugin-quarantine.spec.ts`（9）：写入/幂等/前缀混淆/结尾换行，以及全部拒绝线（非属主行、解析失败、空文件、已存在）。`tests/agent-supervisor-selfheal.spec.ts`（4）：经真实 Supervisor 的完整闭环——第一次失败只观察、第二次归因并恰好禁用涉事行（i18n 行不动）、无法归因时 patch 不动、暂停/`autoRepair: false` 全静默、`started: true` 的崩溃不触发该线。`packages/dsh-doctor` 全套 389/389 与 `tsc --noEmit` 通过。Supervisor 层变更：下次 supervisor 服务重启（`dsh-doctor service-install`）生效，无需重启 host。