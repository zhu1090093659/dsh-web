# Agent Note: Git Graph hero chip seat is asserted per commit, not watched

Status: implemented
已退役，参见 [dsh-git-graph 包退役决策](../simplification/2026-11-03-git-graph-package-retired.md)

## Problem

启用 git-graph 插件后，空白（hero）会话会卡死 DSH 桌面端渲染进程：渲染进程单核 100%，输入与点击无响应，CDP 命令也无响应，只能杀掉进程。禁用插件后同一会话恢复正常。

卡死来自 `packages/dsh-git-graph/src/client/chips/BranchChip.tsx` 的 hero chip 摆放 effect：它在 hero 行的 `childList` 上挂 `MutationObserver`，并用 `insertBefore` 把 portal 出来的 chip 挪回行尾 options 组之前。这个挪动本身就是被观察行的一次 `childList` 变更，观察者因此重新排入自己的回调；整个循环跑在微任务里，从不回到宏任务队列，渲染进程被饿死。

观察者只有一个存在理由：React 把 portal 子节点追加到最后，一次 commit 可能把 chip 留在行尾而不是它的座位上，而 effect 的依赖数组并没有覆盖每一次会挪动它的 commit。

## Decision

chip 的座位改为每次 commit 断言一次，并且组件不再写入自己所观察的容器。

1. **不在被改写的行上挂观察者**：摆放 effect 不再对 `heroRow` 创建 `MutationObserver`。向被观察容器写入的组件会重新排入自己的回调，这正是本记录描述的缺陷。
2. **每次 commit 后断言**：摆放放在没有依赖数组的 `useLayoutEffect` 里，因此 chip 的每次 commit 之后都会重新断言座位。React 的 DOM 变更发生在 layout effect 之前，所以挪走 chip 的那次 commit 内部座位就会被复原；没有挪动 chip 的 commit 则完全不产生 DOM 写入。
3. **幂等守卫**：写入保留原有守卫（chip 在该行内，且 chip 已经紧邻行尾 options 组之前），因此重复断言是空操作。

hero 行探测 effect 保持原样：它观察 composer stack 以确定要 portal 进哪一行，从不写入该 stack，只负责解析行的身份。插件的 portal 摆放机制本身没有变化，仍由 [hero chip portal 记录](./2026-08-31-git-graph-branch-chip-hero-portal.zh.md) 拥有。

## Alternatives considered

- **保留观察者并屏蔽自己产生的记录**：`MutationObserver` 在回调执行时无法分辨一条记录来自组件自己的 `insertBefore` 还是外部变更，因此屏蔽需要跨微任务边界保持的标志位。标志位漏掉会让观察者退回反馈环，标志位错留会跳过一次本该发生的重排：两种失效都是静默的。
- **保留观察者但把重排调度到 `requestAnimationFrame`**：这把写入移出了微任务队列，但仍保留了一条通往非自有容器的异步写入路径，而且在行持续变动时待执行帧仍会无界累积。
- **保留观察者但缩小观察目标**：观察者必须看到行自身的子节点才能发现 chip 离开座位，而行恰恰是组件要写入的容器。缩小目标只会去掉信号，不会去掉写入。

## Consequences

- 启用插件的空白会话保持响应：渲染进程不再进入自我重排的微任务循环，hero chip 仍坐在 agent-preset 座位旁边。
- chip 的座位能挺过那些让 React 把 portal 子节点追加到最后的 refetch commit，因为断言在每次 commit 之后执行。
- 组件不再响应发生在 chip 的 commit 之外的 hero 行变更；座位改由下一次 commit 重新断言，这覆盖了 React 自身产生的全部情形。
- [hero chip portal 记录](./2026-08-31-git-graph-branch-chip-hero-portal.zh.md) 曾把重排描述为发生在行子节点每次变更时；该措辞描述的是已被移除的观察器，机制现在由本记录拥有。

## Testing

- `packages/dsh-git-graph/tests/client.spec.tsx` 覆盖契约的两半：hero 行的变更不会挪动 chip（观察者已移除），下一次 commit 会重新断言 chip 的座位。
- 同一个测试文件在修复前的摆放 effect 下失败，因此回归由测试套件钉住，而不是靠人工检查。
