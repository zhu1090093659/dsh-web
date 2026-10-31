# Agent Note: 任务看板事件流静默恢复与未结算执行校验

Status: implemented

## Problem

任务看板的浏览器镜像依赖 Server-Sent Events（`/api/task-board/events`）获知 Host 状态的变化。然而，SSE 推送通道从浏览器侧是不可验证的：HTTP 流可能在两端均未显式关闭的情况下停止投递字节（例如 TCP 半开套接字，或停止读取/转发的反向代理中转）。在这种状态下，浏览器的 `EventSource` 既收不到任何数据帧，也不会触发 `onerror` 事件，流陷入完全沉默。

当该静默发生在有任务执行正在进行时，镜像会一直将该卡片渲染为「运行中」，即使 Host 的 runner 早已为该任务记录了 sessionId、完成了执行并在 `$DSH_HOME/task-board/ledger-v2.json` 中完成了结算。用户界面因此被永久挂死在过期的进行中状态。

此外，在 Host 侧，此前的事件流处理器忽略了写失败（Node.js 仅在 `res.write` 的回调中报告写失败），且未在 HTTP 响应上监听 `error` 事件。失效的连接因此长期驻留在 Host 内存中，持续向空无一物的连接发送心跳，既不销毁响应也不注销订阅。

## Decision

提交 `fc590adcc` 通过 Host 与客户端两侧的四项协同机制解决了流静默与推送不可验证问题，规则面约定记录在 `packages/dsh-task-board/AGENTS.md` 的「浏览器镜像与推送」一节：

1. **Host 侧流失效清理（`packages/dsh-task-board/src/host-routes.ts`）**：`/api/task-board/events` 为每次 `res.write` 调用传入完成回调，并在 `res` 上监听 `error` 事件。由于 Node 仅在回调中报告断开的管道或写失败（其返回值仅表示背压而非错误），任何写回调错误或响应 `error` 事件均会立即清除心跳定时器、注销账本变更订阅，并调用 `res.destroy()` 强制销毁响应。这迫使 TCP 连接断开，使浏览器的 `EventSource` 感知到连接关闭并触发 `onerror`。
2. **连接建立时的重新同步（`packages/dsh-task-board/src/client/host-api.ts`）**：`HttpTaskBoardHostTransport.subscribe` 挂接了 `events.onopen`，使每次连接建立或重新连接都触发一次快照重读。虽然路由在建立连接时会推送一帧当前状态，但若该帧的 revision 与镜像已持有的 revision 一致，面板不会触发重读；在 `onopen` 处主动重读将每次重连都作为权威重新同步点，而无需等待后续 Host revision 再次前进。
3. **未结算执行的有界校验读取（`packages/dsh-task-board/src/client/pending-verify.ts`）**：由于 SSE 推送帧从浏览器侧本质上不可验证（沉默的流既无数据也无报错），镜像必须主动校验唯一确知为短暂的状态——进行中的未结算执行。只要 `controller.getSnapshot().tasks.some(hasOpenExecution)` 为真，`startPendingVerification` 便每 15 秒（`PENDING_VERIFICATION_MS = 15_000`，与流报错恢复间隔对齐）向 Host 读取一次快照。一旦最后一个进行中执行结算完成，校验循环立即自我解除武装并停止。无未结算执行的空闲看板一次都不读，严格遵守「空闲看板不轮询」原则。此外，当页面处于不可见状态时（`document.visibilityState !== 'visible'`），读取会被推迟至页面重新可见时再进行。
4. **`controller.ts` 的 `refreshRemote` 不引入 in-flight 请求合并（2026-10-31 决策）**：`TaskBoardController.refreshRemote()` 刻意不引入对并发快照请求的 in-flight 合并（请求去重）。快照应用（`acceptRemote`）通过 revision 单调比对（`snapshot.revision < this.hostState.revision` 时安全忽略）本身已具备幂等性；相反，粗糙的请求合并（如复用正在飞行的 Promise）会在可见性切换或重连时序下，让后续触发拿到在变更前已发起的旧快照结果。其代价是在重连风暴等并发触发下会发出重复的 `GET /api/task-board/state` 请求；为确保快照的新鲜度与正确性，明确接受该开销。

## Alternatives considered

- **把心跳注释帧当数据帧**：否决。在 `/api/task-board/events` 上每 15 秒发送的心跳是 SSE 注释帧（`: ping\n\n`），其作用是防止中间代理超时断开空闲连接。根据 W3C Server-Sent Events 规范，浏览器不会将注释帧交给面板的 `EventSource` 监听器，应用层完全不可见。它仅能在传输链路上保活，不得被当作应用层数据帧使用。
- **空闲看板无条件轮询**：否决。在无论看板是否有工作的情况下均无条件定期轮询，违反了任务看板「空闲看板不轮询」的核心架构规则（确立于 issue #1821 与 `.agents/notes/implemented/bug-fix/2026-10-06-task-board-idle-roster-poll.md`）。此外，每次轮询均会触发账本全量读取（读取整个账本快照与构建状态），在无任务执行时造成无谓的 CPU 与磁盘 I/O 放大。
- **只依赖 `EventSource.onerror`**：否决。在半开套接字或代理中转停读时，操作系统与浏览器网络层未收到关闭包，无法感知连接中断，因此在流陷入沉默时 `onerror` 根本不会被触发，镜像将永远停滞在旧状态。
- **在 `controller.refreshRemote` 中合并 in-flight 请求**：否决。对并发的 `GET /api/task-board/state` 进行粗糙合并会引入竞态条件：由稍后事件（如页面可见性恢复或 `onopen`）触发的刷新若复用之前发起的请求，可能返回在 Host 状态更新前就已经拉取的旧快照。revision 单调比对已确保重复响应安全幂等。

## Consequences

- Host 侧在写失败或响应报错时会主动清理失效的 SSE 连接，释放 Node.js 定时器与账本订阅。
- 当执行在 SSE 链路中断期间结算时，浏览器镜像不会被永久卡在「运行中」，有界校验读取保证在 15 秒内收敛恢复。
- 无未结算任务的空闲看板不产生任何校验读取，保持零额外 HTTP 请求开销。
- 重连后的事件流在 `onopen` 时均能重新同步最新的 Host 权威快照。
- `controller.ts` 的单调 revision 检查确保客户端不会回退到旧快照，同时容忍重连风暴下的瞬时并发重复请求。
