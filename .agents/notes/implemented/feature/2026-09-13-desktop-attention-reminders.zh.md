# Agent Note: 桌面端后台提醒

Status: implemented

## Problem

issue #1498 描述的是这样一类失败：同时跑着几个对话，然后切到别的窗口干活——审批请求、回合完成、回合中断都不会产生任何 GUI 之外的可见信号，于是一次运行会一直卡在确认上，直到用户碰巧切回来。该需求里的音频那一半已经由社区插件 `dsh-notifier` 满足；没有被满足的是任务栏那一半——浏览器页面根本触达不到，只有 Electron 主进程可以（`BrowserWindow.flashFrame`）。仓库里的 `desktop/` 外壳早就存在，但它的 preload 只服务本地启动页与错误页：GUI 没有任何可用的「渲染进程 → 主进程」通路，即使有，主进程侧也没有相应策略。

## Decision

后台提醒是桌面外壳的能力，完全实现在 `desktop/` 内——不新增 DSH 插件、不新增包，也不给 web profile 增加任何运行时表面。

### 观察器

GUI 是普通网页内容、不认识这个外壳，因此 `desktop/src/attention-observer.js` 会在每次页面加载后注入到页面主世界（`did-finish-load`，且限定为回环 GUI URL，启动页与错误页什么都不注入）。它用 `MutationObserver` 观察 DOM，并从**有意标注**的钩子读取四个累计计数——绝不依赖 CSS-Modules 哈希：

| 钩子 | 计数含义 |
| --- | --- |
| `:is([data-approval-key], [data-question-key], [data-plan-review-key])` | 运行在等用户时渲染出的输入区接管面板 |
| `[data-chat-flow-kind="turn-tail"]` | 已结束的回合（ui-chat 在 `turn/end` 时无论原因都会发布一个） |
| `[data-chat-flow-kind="turn-error"]` | 以 `reason.kind === 'error'` 结束的回合 |
| `[data-state="stopped"]` | 被中断的工具调用 |

信号来自相邻两次快照的比较，且**只在增加时**产生：会话历史在消息流里是累计的，而减少（切换会话、重载）没有含义。第一次快照只用来打底，因此带着历史加载的页面不会谎报「刚刚结束了一个回合」。1.5 秒的沉降窗口用于吸收一次结算引发的 DOM 抖动。

### 桥与策略

`desktop/src/preload.cjs` 在既有 `desktop` 桥上暴露 `notify(kind)`；主进程重新校验发送方（必须是 GUI 窗口的 webContents）与载荷（封闭枚举 `approval` / `completed` / `interrupted`），再由 `raiseAttention` 执行策略：窗口处于焦点时绝不打扰，4 秒冷却合并连续信号，闪烁与提示音可通过可选的 `$DSH_HOME/desktop-attention.json` 分别关闭，且 `flashFrame(true)` 会在窗口下一次 `focus` 时清除。

## Alternatives considered

**主进程直接订阅宿主协议（`/api/remote.mux` 的 `session/follow`）。** 这是读取 `turn/end` 权威 reason 联合的唯一途径；本次改动前的调研确认它需要独自处理 token，并且会复制一份 GUI 已持有的连接。本次否决：那等于再当一次宿主客户端，自带鉴权、重连与流生命周期表面，而该功能的价值只是一个后台闪烁。它仍然是「精确判定中断」的既定路径，只是外壳暂不采用。

**用侧栏运行指示（`[data-state="ongoing"]`）推导「回合结束」。** 否决：该指示是全局的，多个对话同时运行时提醒只在**最后一个**结算时才触发；而逐行的信号也不可得——会话行是 `role="treeitem"`，没有任何 session-id 属性可作键。`turn-tail` 恰好每个已结束回合一个节点，且完全不需要身份。

**改为匹配「已停止」标记。** 被中断的助手消息上的停止标记是 CSS-Modules 哈希类名加本地化文案。否决：匹配任一个都会在下一次官方重建或切换语言时失效，这正是皮肤契约已经禁止的那类脆弱点。

**用渲染进程的 `Notification` API 代替任务栏。** 否决：需求明确要的是任务栏；Electron 的 `Notification` 还自带一条权限路径；而页面内与系统级通知已由 `dsh-notifier` 覆盖。

**在桌面应用里加设置界面。** 否决：应用本来没有设置界面，为两个布尔值新增一套界面比功能本身还重；`$DSH_HOME/desktop-attention.json` 已做校验，只有字面量 `false` 才关闭通道，任何笔误都回落到默认值。

## Consequences

- 桌面应用现在能告诉用户「有运行在等你」，这是任何浏览器侧插件都做不到的。
- 注入 GUI 页面多了一个文件。它只读属性并调用 `notify`，从不触碰页面状态，桥缺失时静默吞掉。
- 三种 kind 构成观察器、preload、主进程三个文件之间的契约，由 `desktop/tests/attention.test.mjs` 连同判定规则一起断言；`pnpm test:desktop` 是门禁。
- 「中断」是启发式：出错回合与被中断的工具调用会上报为 `interrupted`，但用户停止一个只输出正文的回合时页面没有任何语义属性，会上报为 `completed`。这一点写在桌面 README 的已知限制里，不隐藏。
- 提醒按「已结算的回合」触发，而非按对话身份：外壳无法可靠地说出是**哪一个**对话结束了，因此不作此尝试。
- 提醒只存在于桌面外壳；浏览器标签页仍然没有。
