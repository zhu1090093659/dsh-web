# Agent Note: 移除消息编辑插件与 win-bash 的梁神门控

Status: implemented

[English](2026-11-14-retire-message-edit-and-win-bash-gate.md) | 中文

替代关系检查：本 Note 退役 [文本消息编辑重发](../../archived/feature/2026-10-24-message-edit-and-resend.zh.md) 归属的能力，并收窄 [dsh-win-bash-pinned-bash](../feature/2026-10-16-dsh-win-bash-pinned-bash.zh.md) 记录的可用性决定。两项决定都没有被别处逆转：fork 边界的前提保留在归档的特性 Note 中，钉死载荷、缓存发布与 shell 阶梯的决定继续有效。

## Problem

两处已发布的面带来的成本大于收益。`@linxin666/dsh-client-ui-message-edit` 在回合末尾加一个「编辑并重发」入口并 fork 分支会话，它制造的分支噪音超过它提供的更正价值，而这个插件没有设置项、没有持久化格式，除这一个入口之外没有任何消费者。`@linxin666/dsh-win-bash` 只在声明了 `liangshen` agent preset 的部署里注册 `win_bash`，于是从不启用该预设的 Windows 用户完全得不到这个常驻 bash，尽管平台守卫与载荷校验已经在决定这个工具能不能工作。

## Decision

消息编辑插件离开仓库与聚合：包目录、`patchFrom` 与 `deps` 行、`dsh-i18n` 的 ru 字典、覆盖面基线条目、i18n 审计条目、共享副本目标以及全部文档引用。它没有 tombstones 子路径与展示元数据，因此老 profile 里残留的 `@linxin666/dsh-web-all/message-edit` 行名在 import 阶段直接报错，而不是静默挂载一个空壳。

`win_bash` 不再跟随梁神预设：`src/gate.ts`、`syncWithLiangShen` 配置字段与等待预设名册的挂载续延一并删除，载荷校验与配置解析通过后 `apply` 同步注册工具，注册失败记日志而不以未处理拒绝逃逸。可用性只跟随平台守卫与载荷校验。旧 profile 行若仍带 `syncWithLiangShen` 照常挂载——该键不再声明，因此被忽略。

## Alternatives considered

- **留在全家桶但出厂停用**：否决。出厂关闭的行仍然要发布它的浏览器 bundle、i18n 条目与维护成本，而且没有任何东西会把它重新打开。
- **保留聚合行空壳、包留给独立安装**：否决。请求是从项目中移除；该插件也不提供官方 composer 管线缺失的能力。
- **把门控保留成出厂关闭的 `syncWithLiangShen` 开关**：否决。预设耦合本身就是缺陷；没人会拨的开关只是把错误的缺席留给每个不跑梁神的 Windows 用户。
- **改为把 `win-bash` 放进聚合 `inactive` 清单**：否决。工具在不受支持的平台上本来就拒绝挂载，再加一层开启开关只是多一步，并没有解决耦合。

## Consequences

Windows x64 会话无需启用梁神即可得到 `win_bash`；声明了该预设的 profile 行为不变，未声明的 profile 在宿主下次重启后获得该工具。消息编辑没有替代品：发错的消息只能靠继续对话或新开会话来绕开。残留的旧 profile 行在 import 阶段硬报错，这正是家族被彻底移除后的既定行为。归档的特性 Note 保留了原有的 fork 边界依据，供日后重新考虑该能力时查阅。

## Testing

- `node scripts/aggregate.mjs --check` 报 20 行、18 个依赖、3 个退役项；`pnpm aggregate:check` 一致。
- `pnpm i18n:check`、`pnpm docs:check`、`pnpm libs:check`、`pnpm test:scripts` 通过；`pnpm-lock.yaml` 去掉该 workspace 包与聚合依赖。
- `pnpm --filter @linxin666/dsh-win-bash typecheck && pnpm --filter @linxin666/dsh-win-bash test && pnpm --filter @linxin666/dsh-win-bash build` 通过；包测试断言在不提供任何预设注册表、也不读名册的上下文里仍注册工具。
