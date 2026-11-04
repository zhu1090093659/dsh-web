# Agent Note: Git Graph 分支 chip 只挂 composer 输入 dock

Status: implemented
已退役，参见 [dsh-git-graph 包退役决策](../simplification/2026-11-03-git-graph-package-retired.md)

## Problem

分支 chip 曾有两个挂载座位：优先等待 `conversation.input.selector.context` 并留 2000 ms 的 `CONTEXT_FALLBACK_MS` 窗口，失败后回退 `conversation.input.dock`。该优先洞只存在于更早的 shell；随发行的 0.2.1-rc.2 shell 声明的是 `conversation.input.dock / left / right / plan / permission / attachments / activity / model / overlay / for`，根本没有 selector-context 洞，于是每次加载都先在永远不会解析的等待上耗掉回退窗口，chip 真正的座位始终是 dock。

## Decision

分支 chip 只挂 `conversation.input.dock`。`apply()` 通过 `slots.inject` 等该槽位声明（裸 `register` 会因槽位未声明而抛错），注册唯一的 `git-graph` entry（order 100）；回退定时器、`CONTEXT_FALLBACK_MS`、本地声明的 `conversation.input.selector.context` SlotMap 条目与两座位 props 联合类型全部移除。`BranchChipProps` 即 dock 座位的 runtime share 加注入面与 locale 座位。

空白会话 hero 相位里，chip 仍 portal 进官方 hero 行，并落在该行行尾 options 组之前（见[hero portal 记录](../bug-fix/2026-08-31-git-graph-branch-chip-hero-portal.md)）；dock 仍是挂载座位，chip 是它附加的唯一占用者。

## Alternatives considered

- **保留声明感知的优先座位**：每次加载都要空等 2 s，且依赖没有任何随发行 shell 声明的洞；即便将来 shell 重新声明，没有新的定位工作可见位置也不会变。
- **不用 `inject` 直接 register dock**：SDK 会拒绝注册进未声明槽位，声明较晚的 shell 将完全失去 chip。

## Consequences

- shell 一声明 dock，chip 即挂载，不再等待固定窗口。
- 单座位没有双挂载风险：既无等待可释放，也不存在需要忽略的迟到声明。
- 若某个 shell 移除 `conversation.input.dock`，分支 chip 将不渲染；该 seam 就是 shell 为自己的队列 dock 与 todo dock 声明的 composer dock。

## Testing

- `packages/dsh-git-graph/tests/client-apply.spec.tsx` 覆盖立即挂载、迟到声明与单座位保证。
- `packages/dsh-git-graph/tests/client.spec.tsx` 只构造 dock props，context 座位用例已删除。
- 仓库门禁：`pnpm typecheck`、`pnpm test`、`pnpm test:standards`、`pnpm docs:check`、`pnpm i18n:check`、`pnpm libs:check`。
