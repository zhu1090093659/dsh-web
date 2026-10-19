# Agent Note: 聚合包 shell 隔离单插件启动故障

Status: implemented

> 部分被取代：家族行不再挂 shell。[聚合家族行直挂真实包](2026-10-18-aggregate-family-rows-mount-real-packages.zh.md)记录了这次改动，
> 以及本记录当初主张的故障隔离代价。shell 模块、它的降级账本，以及为改动前
> 写下的 profile 保留的子路径导出都没有变化。

## Problem

dsh-web 家族以一个聚合 bundle 发布，patch 行经 DSH loader 挂载约 20 个插件。loader 把全部行作为一个事务组处理（vendored cordis loader 的 `EntryGroup.update`）：任何一个 entry import 或启动失败都会回滚整组，boot 审计（`@deepseek-ai/dsh-app-boot` 的 `assertEntriesActivated`）随后中止整个 `dsh web` 进程。一个坏插件——SDK 漂移、坏版本、第三方 import——就能把所有插件拖死，与"一切皆插件"的组合前提相悖。家族已经为这个形态付过整次 boot 的代价（chatgpt-subscription 的 `CallId` import 崩溃，2026-08-28；宿主 SDK 漂移在 import 阶段杀死第三方插件）。

## Decision

故障单位从整个家族收缩为单个插件。`scripts/aggregate.mjs` 为每个家族 insert 行生成 `name: '@linxin666/dsh-web-all/<family>'`（聚合包按家族的子路径导出，共享目标是故障隔离 shell），真插件包名放在行配置（`config.plugin`），被包装插件自己的配置字段与它平级放在行配置根。shell（`packages/dsh-web-all/src/shell.ts`）在启动时 import 真模块；import 失败、模块形态不可用、或激活失败（同步抛错或 fiber 拒绝）都会被捕获、记日志并登记——shell entry 本身保持 active，boot 审计看到的是健康的树，其余插件照常挂载。（行名最初是裸包名；子路径显示名是后续决策——见[聚合家族行显示名](2026-09-02-aggregate-family-row-display-names.zh.md)。）

真插件作为 shell 子上下文上的嵌套插件运行，cordis 语义不变：它 provide 的服务经正常作用域链可见，生命周期跟随 shell entry，后续失败只撤回自己的服务。一个仅限 loopback 的健康路由（`GET /api/dsh-web-all/degraded`）报告当前降级台账（`@linxin666/dsh-web-all/degraded`），监控可以不刮日志就知道"哪些插件降级了"。`dsh-i18n` 保持直挂（宿主半区是空函数），外部行（家族之外的 npm 包）也全部直挂——失败语义由其属主负责。

行配置同时就是被包装插件的设置面。宿主设置面（`@deepseek-ai/dsh-settings`）按 profile entry 各自的 `Config` schema 生成表单，并拒绝写入没有声明为 volatile 的路径——而家族行的这份 schema 属于 shell，不属于插件。因此 shell 声明 `Config = z.any().volatile()`：

- 用 `any` 而非对象：对象 schema 只投影自己声明的键，浏览器卡片会读到空值；家族字段留在表单根，正是一个独立安装的同名包所在的位置，于是同一份 profile 配置在两种挂载方式下都成立。
- 用 `.volatile()`：没有 volatile 字段的 schema 根本不进设置面（设置面经 `volatileForm()` 投影），而 volatile 落在根节点时任意路径都可写（`isVolatilePath` 命中 `schema.meta.volatile` 即短路）。

根节点 volatile 同时把编辑放进 live 路径：loader 把新配置提交进运行中 entry 的引用、而不是重挂载该行（无 volatile 节点的 schema 会重挂载整行），因此 shell 监听 `loader/volatile-update`，用已提交的配置重新挂载家族插件——这正是家族插件对自己 volatile 字段既有的 live 生效契约。

被包装插件自己的 `Config` 仍然决定取值是否成立：shell 把家族字段交给 `ctx.plugin()`，由那份 schema 校验，因此一次非法写入只会让这一行降级（台账与日志可见），家族其余部分照常运行。

作为 boot 期 shell 的补充，`shared/host/run-guarded.ts` 把 fire-and-forget 的 Promise 拒绝转为日志错误：宿主的 `installFailLoud` 会把任何 unhandled rejection 变成整个进程退出，家族代码必须从结构上杜绝逃逸。

## Alternatives considered

等待 loader 级 `continueOnError` entry 选项被推迟：那是宿主级的完整答案但在本仓库边界之外，shell 用当前宿主（0.1.2-alpha.3）就达成了同样的故障包含。把外部行也包进 shell 被否决：第三方插件有自己的生命周期契约，inactive 行机制已覆盖 opt-in 外部包。仅靠 supervisor（检测 boot 循环、禁用、重启——未来 doctor 闭环）被推迟到二期：它缩短恢复时间，但不具备 shell 的故障包含能力。

设置面另有三种形态被否决。在 shell 激活时 import 家族模块以读取其 `Config` 被直接否决：急切 import shell 本就负责隔离的那个模块，正是这个 shell 存在的意义所在。保留嵌套行配置（`config.plugin` + `config.config`）并让每个家族卡片去寻址内层路径被否决：那是横跨十个客户端包的改动，会把聚合包的内部形态漏进各个卡片，而原生 `ctx.configForms` 绑定根本带不了路径前缀。给每个家族插件加回专用写路由被否决：那是把逐插件持久化重新引回来，只在 loopback 桥上生效（配对远程浏览器上家族设置会失效），并且让设置面对自己服务的内容撒谎。

## Consequences

家族插件在 boot 期不再可能拖垮 Web：坏插件的影响半径是一个降级 entry 加一条日志。代价：插件故障只经日志/degraded 路由呈现而非 boot 失败、未来每个新家族包都要经 `scripts/aggregate.mjs` 生成聚合行（这本来就是唯一合规路径）。原先"插件列表每行显示同一个 shell 包名"的显示代价已由按家族的子路径行名移除（见[聚合家族行显示名](2026-09-02-aggregate-family-row-display-names.zh.md)）。runGuarded 纪律按包 opt-in；本仓当前没有包采用它，因此 `shared/host/run-guarded.ts` 只作为共享源与该模块的测试保留，本仓不再生成副本。

设置面带来三项代价。宿主在写入时无法校验家族字段（它没有这些字段的 schema），因此被家族 schema 拒绝的值只会让这一行降级，而不是带着原因被拒。行配置编辑会重新挂载家族插件而非就地提交，因为 shell 交给 `ctx.plugin()` 的是一份普通配置。设置写入会持久化整份生效行配置——包含 shell 自己的 `plugin` 键，正是它让该行继续挂载正确的模块——所以手写覆盖也必须带 `plugin`；缺失它的配置会让该行什么都不挂载，除 loader 整对象替换产生的裸覆盖形态（静默）之外都会在台账里留痕。

## Testing

`packages/dsh-web-all/tests/shell-isolation.spec.ts` 经真实安装的宿主 boot（`@deepseek-ai/dsh-app-boot`）验证契约：启动失败与 import 失败两个场景下 shell entry 都保持 ACTIVE、健康兄弟照常挂载且其服务在根上下文可达，no-webServer 场景证明 degraded 路由是尽力而为，对照组（直挂，今日形态）依然炸掉 boot——锚定 shell 存在的理由。`packages/dsh-web-all/tests/shell-config-surface.spec.ts` 钉住设置面：schema 的根 volatile 形态与单引用校验、只转发家族字段、`loader/volatile-update` 触发重挂载（值未变则不重挂），以及两个真实 boot 场景——扁平行配置经家族自己的 schema 校验后到达 `apply`，非法配置则让 shell entry 保持 ACTIVE、健康兄弟不受影响。`scripts/aggregate.test.mjs` 把生成的 patch 钉在扁平形态上。`pnpm typecheck`、`pnpm test`（全部 22 个 workspace 包）、`pnpm docs:check`、`pnpm aggregate:check`、`node scripts/sync-shared.mjs --check`、`pnpm i18n:check` 通过。bundle 层变更，需用户重启 `dsh web` 生效。