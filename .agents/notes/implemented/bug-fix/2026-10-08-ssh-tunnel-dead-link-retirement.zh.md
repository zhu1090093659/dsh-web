# Agent Note: dsh-ssh 端口转发隧道随 SSH 链路一同退役

Status: implemented

## Problem

`packages/dsh-ssh/src/engine/tunnel.ts` 中的本地端口转发隧道会钉住一条池化 ssh2 连接，并把回环监听一直保留到用户手动停止为止。没有任何环节检查这条连接是否还活着，因此隧道可能比它的链路活得更久：网络抖动、远端重启或 sshd 会话结束后，连接池里的 record 已被标记 `broken`，而隧道仍留在 `engine.tunnels` 中、本地端口仍处于 `listen` 状态（#1839）。

此后任何一次对该端口的本地连接都会在一台已断开的 client 上调用 `client.forwardOut(...)`。ssh2 1.17 并不通过回调上报这一点：`forwardOut` 会同步抛出 `Error: Not connected`，抛出点就在 `net.Server` 的连接回调里，那里没有任何捕获。异常以 uncaught exception 形式逃逸，DSH Host 进程以 exit code 1 退出，当前全部会话中断；报告者在单台机器一周内记录到 7 次同类崩溃，堆栈完全一致。触发条件非常普通：一条长期挂着的隧道，加上任意一次端口探测。

## Decision

- **隧道绝不比链路活得久。** `startTunnel` 在隧道登记进注册表后为 client 挂上 `client.once('close')` 钩子。池化 client 关闭时，钩子走常规停止路径：关闭监听、销毁活动 socket、移除注册表项，并释放被钉住的连接（与兄弟隧道共享的 record 只由最后一条隧道释放）。
- **停止时卸载钩子。** 通过新增的可选字段 `TunnelRecord.detachLink` 实现，使已退役的隧道不会在被复用的池化 client 上留下监听器——`ssh_tunnel` 工具可以在一条长连接上反复创建与停止隧道。
- **连接回调在开通道前先拒绝死链路。** `record.broken`（连接池自己的存活标志）为真时销毁 socket 并退役隧道，覆盖了取到 record 与本地连接到达之间 `startTunnel` 仍在运行时链路断裂的窗口。
- **`forwardOut` 包在 try/catch 中。** 它的同步抛出正是报告中的崩溃；catch 中销毁 socket 并通过同一个幂等助手退役隧道，使异常不再可能逃出 `net` 连接回调。`abortTunnel` 又包了一层 `stopTunnel`，连拆卸过程的报错也被兜住。
- **远端通道报错不等于链路死亡。** `forwardOut` 以回调报错返回（远端服务拒绝、通道忙）时，仍然只销毁该 socket，隧道照旧存活。
- **监听绑定期间死掉的链路由登记后的第二次标志检查兜住**——那个窗口的 `close` 发生在钩子挂上之前。`startTunnel` 仍然正常 resolve，隧道只是不会出现在列表里，这正是报告者期望的行为。

## Testing

`packages/dsh-ssh/tests/tunnel-dead-link.test.ts` 用一个假的 ssh2 client 驱动真实监听器：同步抛出 `Not connected`、连接到达时已被标记 broken、健康转发后 client 关闭、同一连接上的兄弟隧道、健康转发后手动停止。对修复前的源码，该套件 5 个用例中有 4 个失败，并复现 issue 中完全相同的 uncaught exception（`Error: Not connected` 位于 `Server.<anonymous> src/engine/tunnel.ts`），因此回归覆盖本身就是复现。

## Alternatives considered

- **保留隧道，让每次连接各自失败。** 否决——什么都没解决：守卫未预料到的路径仍可触达崩溃，并且留下一个永远无法服务的监听器，而这正是报告者明确排除的行为。
- **在连接回调里按需重连（`withClient` 那套重试形状）。** 否决——端口转发的本地 TCP 客户端期待一个稳定的监听器，静默重连会引入池在这条路径上并不拥有的延迟与重连语义，而重连可能重放非幂等工作的既定代价对一次转发毫无收益。隧道本就是刻意钉住的，让它退役、由用户重新建立才是诚实的结论。
- **只在连接回调体外包一层 try/catch，不退役隧道。** 否决——崩溃被兜住了，但僵尸隧道和它那条死掉的被钉连接永久留在注册表里，之后每次连接都重复一次拒绝，连接池还一直钉着一具尸体。
- **加 `process.on('uncaughtException')` 兜底。** 否决——那属于 DSH 核心而非本插件，而且会把其他潜在抛出一起掩盖，而不是修好这条路径。
- **同时监听 client 的 `error` 与 `close`。** 否决——`close` 才是传输彻底死亡的终态事件，而 `record.broken` 检查已经覆盖了连接时先报错再关闭的窗口；再监听 `error` 会让传输本可挺过的瞬时错误也导致隧道退役。

## Consequences

- 链路断开后，隧道立即离开注册表，本地端口不再接受连接：操作者在下次列表刷新（五秒）时看到它消失并重新建立；断线期间到达的那次连接会被关闭且没有流量。修复前，同一次连接会终结 Host 进程。
- 删除主机与修改连接字段的行为不变：它们通过同一条停止路径关闭该别名的隧道。
- 最后一条隧道仍只会被 end 一次；共享 record 由最后退役的兄弟隧道释放。
