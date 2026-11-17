# Agent Note: 任务看板 Host 失败原因与残留锁回收

Status: implemented

## Problem

issue #1528 报告了一块从未挂载过 Host 半区的看板：面板显示 `Host 操作失败：Unexpected token 'o', "not found" is not valid JSON`，任务列表永远为空；磁盘证据是一个 0 字节的 `ledger-v2.lock`，它的 mtime 停在两天前，而正在运行的宿主是之后才启动的。

造成这个现象的是两个缺陷。浏览器传输层把每个响应都当成 JSON 解析，于是核心 Web 服务对未挂载 `/api` 路径返回的纯文本 `not found` 变成了用户看到的错误。而 `HostTaskLedger.acquireLock` 把「读不出内容的锁」当作致命错误，于是异常退出留下的残留文件会一直阻止整个 Host 半区挂载，直到有人手动删掉它。

issue #2061 报告了同一种静默，来自锁的另一条分支。硬杀（`taskkill /F`）让 `dispose()` 来不及执行，`ledger-v2.lock` 因此留在盘上；当记录里的 PID 已被别的进程复用、而那个进程的启动时间任何探针都读不到（受保护进程，或超时的 WMI/CIM 查询）时，`acquireLock` 无法证明这次复用，于是 fail closed。看板行停在 `failed`，`/api/task-board/*` 全部回答 404，`scheduler-v2.json` 的 `lastTickAt` 冻结，第二天早上的定时卡片被错过，而 `/` 仍返回 401、看起来一切健康。

## Decision

浏览器传输层现在对 Host 失败分类（`not-mounted`、`ledger-locked`、`degraded`、`unauthorized`、`forbidden`、`locked`、`rejected`、`timeout`、`unreachable`、`unexpected`），每一类在当前语言下渲染成自己的那句话；非 JSON 的响应体不会再被交给 `JSON.parse`。事件流连不上时，面板会被提醒去读一次状态（最多每 15 秒一次），因此从未挂载的 Host 半区会显示出来，而不是一直静默空白。

`HostTaskLedger` 会在不可读锁的 mtime 超过 `UNREADABLE_LOCK_GRACE_MS`（60 秒）后回收它。持有者在 `O_EXCL` 之后立刻写入并 fsync 自己的记录，所以存在这么久的不可读锁不可能是正在写入。新的不可读锁仍然 fail closed 并给出恢复提示，能识别出活持有者的锁仍然拒绝抢占。

锁持有者每 `LOCK_HEARTBEAT_MS`（30 秒）跳一次：`renewLock()` 重读记录，token 不再是自己的就停跳，否则用 `utimesSync` 移动锁文件的 mtime。记录本身从不改变，`dispose()` 清掉定时器。这个 mtime 就是第二身份来源：当记录里的 PID 活着但启动时间读不到时，一把至少 `UNREADABLE_LOCK_GRACE_MS`（两个心跳）没被碰过的锁不可能属于正在运行的持有者，于是它被重命名为 `ledger-v2.lock.orphan-<ts>`，一条 `console.warn` 写明 pid 与心跳年龄，这次启动接管它。新鲜的锁、以及活持有者身份与记录相符的锁，仍然 fail closed——单凭「身份读不到」永远不构成残留锁的证明。身份读取本身位于可注入的 `LockProcessProbe` 之后，因此这条分支在每个平台上都能被验证，不需要真的跑一趟 PowerShell。

看板自身路由的裸 404 是「这些路由不存在」的唯一信号。渲染它之前，传输层会去读家族健康路由 `api/dsh-web-all/degraded`（文档相对，issue #1707），按包名找到本行：若该行在启动时降级，壳记录的 reason 就会取代泛化文案——reason 指向一个活着的持有者时给出 `ledger-locked` 与持有者 pid，否则给出 `degraded` 与原样 reason。这次查找是尽力而为的：缺失、拒绝、读不出或形状未知的回答一律保留 `not-mounted`。

壳的降级记录新增了有界的单行 `reason` 字段，与完整的 `message`（含栈）并存，并由 `GET /api/dsh-web-all/degraded` 提供——纯增量，早于该字段的读者继续用 stage/message。该路由仅限 loopback；家族 `/api/dsh-web-all/rows` 行账本仍会列出插件已降级的行，因为该行确实是 active 的，它的 UI 入口必须挺过这次失败（解释它的信号是降级账本）。

## Alternatives considered

把原始解析错误连同排障文档链接一起显示：否决。面板是报告者唯一能看到的界面，而一句 JavaScript 运行时错误无法说明三种失败中到底发生了什么。

无条件回收不可读锁：否决。在 `openSync(..., 'wx')` 与持有者 `writeFileSync` 之间文件本来就是空的，此时回收会让第二个账本写入者同时写同一份文档。

让看板自己的路由挂在一个「无需账本即可构造」的 Host 服务后面（并用 503 返回构造失败原因）：仍然暂缓而非否决。这是精确报告「另一个活着的 DSH 实例持有账本」的另一条路，代价是看板要多一个「账本不存在」的生命周期状态。读家族健康账本不需要这些代价，因为壳已经记录了原因。

对所有缺失路由一律保留 `not-mounted`、只改文案：否决。它说不出占用者是谁，而且会继续建议重启——而重启显然抢不到另一个进程手里的锁。

不加心跳、只按锁年龄接管：否决。报告者的环境同时表明 CIM 查询会在完全健康的宿主上超时，因此单看年龄会让第二次启动抢走活持有者的锁，把两个写入者压到同一份账本文档上。

保留 fail closed 分支、只改文案：否决。家族行不是 required，失败因此只是 stderr 里的一条 warning，而调度器已经消失一整天。心跳才是让接管可证明、而不是靠猜的东西。

## Consequences

失败文案进入任务看板字典以及 `dsh-i18n` 里的俄语镜像。面板现在能区分「接口没挂载」「动作被拒绝」与「账本被另一个进程占用」，这正是排障需要的。

降级家族行为何失败的确切原因，现在只要够得着仅限 loopback 的家族健康路由就能读到，而不再只存在于 Host 日志里。

接管会把原记录作为 orphan 文件留在账本旁边，供运维审计到底是哪个 pid 持有过它；这些文件只在「异常退出且 PID 被复用」之后出现。停止心跳但身份仍然相符的活持有者继续持有锁，面板经家族降级账本点名那个 pid：看板绝不在一个可识别的活进程之上启动第二个写入者。

接管以心跳静默为判据，因此残留风险是「被挂起超过两个心跳、之后又恢复的持有者」：它读到别人的 token 后停止续跳并报告一次丢失，而它已经写入的内容仍留在文档里。这与 PID 复用接管本来就承担的风险相同，账本旁边的 orphan 记录正是让它可审计的东西。
