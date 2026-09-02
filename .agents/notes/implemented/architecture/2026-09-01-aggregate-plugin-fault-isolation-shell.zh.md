# Agent Note: 聚合包 shell 隔离单插件启动故障

Status: implemented

## Problem

dsh-web 家族以一个聚合 bundle 发布，patch 行经 DSH loader 挂载约 20 个插件。loader 把全部行作为一个事务组处理（vendored cordis loader 的 `EntryGroup.update`）：任何一个 entry import 或启动失败都会回滚整组，boot 审计（`@deepseek-ai/dsh-app-boot` 的 `assertEntriesActivated`）随后中止整个 `dsh web` 进程。一个坏插件——SDK 漂移、坏版本、第三方 import——就能把所有插件拖死，与"一切皆插件"的组合前提相悖。家族已经为这个形态付过整次 boot 的代价（chatgpt-subscription 的 `CallId` import 崩溃，2026-08-28；宿主 SDK 漂移在 import 阶段杀死第三方插件）。

## Decision

故障单位从整个家族收缩为单个插件。`scripts/aggregate.mjs` 为每个家族 insert 行生成 `name: '@linxin666/dsh-web-all/<family>'`（聚合包按家族的子路径导出，共享目标是故障隔离 shell），真插件包名放在行配置（`config.plugin`，行原有配置嵌套在 `config.config` 下）。shell（`packages/dsh-web-all/src/shell.ts`）在启动时 import 真模块；import 失败、模块形态不可用、或激活失败（同步抛错或 fiber 拒绝）都会被捕获、记日志并登记——shell entry 本身保持 active，boot 审计看到的是健康的树，其余插件照常挂载。（行名最初是裸包名；子路径显示名是后续决策——见[聚合家族行显示名](2026-09-02-aggregate-family-row-display-names.zh.md)。）

真插件作为 shell 子上下文上的嵌套插件运行，cordis 语义不变：它 provide 的服务经正常作用域链可见，生命周期跟随 shell entry，后续失败只撤回自己的服务。一个仅限 loopback 的健康路由（`GET /api/dsh-web-all/degraded`）报告当前降级台账（`@linxin666/dsh-web-all/degraded`），监控可以不刮日志就知道"哪些插件降级了"。`dsh-i18n` 保持直挂（宿主半区是空函数），外部行（家族之外的 npm 包）也全部直挂——失败语义由其属主负责。

作为 boot 期 shell 的补充，`shared/host/run-guarded.ts`（同步到四个带进程内 HTTP/轮询面的包）把 fire-and-forget 的 Promise 拒绝转为日志错误：宿主的 `installFailLoud` 会把任何 unhandled rejection 变成整个进程退出，家族代码必须从结构上杜绝逃逸。

## Alternatives considered

等待 loader 级 `continueOnError` entry 选项被推迟：那是宿主级的完整答案但在本仓库边界之外，shell 用当前宿主（0.1.2-alpha.3）就达成了同样的故障包含。把外部行也包进 shell 被否决：第三方插件有自己的生命周期契约，inactive 行机制已覆盖 opt-in 外部包。仅靠 supervisor（检测 boot 循环、禁用、重启——未来 doctor 闭环）被推迟到二期：它缩短恢复时间，但不具备 shell 的故障包含能力。

## Consequences

家族插件在 boot 期不再可能拖垮 Web：坏插件的影响半径是一个降级 entry 加一条日志。代价：插件故障只经日志/degraded 路由呈现而非 boot 失败、未来每个新家族包都要经 `scripts/aggregate.mjs` 生成聚合行（这本来就是唯一合规路径）。原先"插件列表每行显示同一个 shell 包名"的显示代价已由按家族的子路径行名移除（见[聚合家族行显示名](2026-09-02-aggregate-family-row-display-names.zh.md)）。runGuarded 纪律按包 opt-in，由 `scripts/sync-shared.mjs` 同步。

## Testing

`packages/dsh-web-all/tests/shell-isolation.spec.ts` 经真实安装的宿主 boot（`@deepseek-ai/dsh-app-boot`）验证契约：启动失败与 import 失败两个场景下 shell entry 都保持 ACTIVE、健康兄弟照常挂载且其服务在根上下文可达，no-webServer 场景证明 degraded 路由是尽力而为，对照组（直挂，今日形态）依然炸掉 boot——锚定 shell 存在的理由。`pnpm typecheck`、`pnpm test`（全部 22 个 workspace 包）、`pnpm docs:check`、`pnpm aggregate:check`、`node scripts/sync-shared.mjs --check`、`pnpm i18n:check` 通过。bundle 层变更，需用户重启 `dsh web` 生效。