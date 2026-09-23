# Agent Note: 任务看板 Host 失败原因与残留锁回收

Status: implemented

## Problem

issue #1528 报告了一块从未挂载过 Host 半区的看板：面板显示 `Host 操作失败：Unexpected token 'o', "not found" is not valid JSON`，任务列表永远为空；磁盘证据是一个 0 字节的 `ledger-v2.lock`，它的 mtime 停在两天前，而正在运行的宿主是之后才启动的。

造成这个现象的是两个缺陷。浏览器传输层把每个响应都当成 JSON 解析，于是核心 Web 服务对未挂载 `/api` 路径返回的纯文本 `not found` 变成了用户看到的错误。而 `HostTaskLedger.acquireLock` 把「读不出内容的锁」当作致命错误，于是异常退出留下的残留文件会一直阻止整个 Host 半区挂载，直到有人手动删掉它。

## Decision

浏览器传输层现在对 Host 失败分类（`not-mounted`、`unauthorized`、`locked`、`rejected`、`timeout`、`unreachable`、`unexpected`），每一类在当前语言下渲染成自己的那句话；非 JSON 的响应体不会再被交给 `JSON.parse`。事件流连不上时，面板会被提醒去读一次状态（最多每 15 秒一次），因此从未挂载的 Host 半区会显示出来，而不是一直静默空白。

`HostTaskLedger` 会在不可读锁的 mtime 超过 `UNREADABLE_LOCK_GRACE_MS`（60 秒）后回收它。持有者在 `O_EXCL` 之后立刻写入并 fsync 自己的记录，所以存在这么久的不可读锁不可能是正在写入。新的不可读锁仍然 fail closed 并给出恢复提示，被活进程持有的锁仍然拒绝抢占。

## Alternatives considered

把原始解析错误连同排障文档链接一起显示：否决。面板是报告者唯一能看到的界面，而一句 JavaScript 运行时错误无法说明三种失败中到底发生了什么。

无条件回收不可读锁：否决。在 `openSync(..., 'wx')` 与持有者 `writeFileSync` 之间文件本来就是空的，此时回收会让第二个账本写入者同时写同一份文档。

注册降级路由、用 503 返回构造失败原因：暂缓而非否决。这是精确报告「另一个活着的 DSH 实例持有账本」的唯一办法，前提是 Host 服务能在没有账本的情况下构造出来；在此之前，未挂载提示里已经写明了这种可能。

## Consequences

失败文案进入任务看板字典以及 `dsh-i18n` 里的俄语镜像。面板现在能区分「接口没挂载」和「动作被拒绝」，这正是排障需要的；而 Host 半区具体为何挂载失败，仍然只在 Host 日志里。
