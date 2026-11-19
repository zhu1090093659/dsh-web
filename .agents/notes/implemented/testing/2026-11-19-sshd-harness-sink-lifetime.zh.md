# Agent Note: sshd 诊断日志流要活过它所捕获的子进程

Status: implemented

## Problem

`pnpm test` 间歇性失败，而包里每个测试都通过：

    packages/dsh-ssh test:  Test Files  29 passed (29)
    packages/dsh-ssh test:        Tests  293 passed (293)
    packages/dsh-ssh test:       Errors  1 error

错误是未捕获的 `Error: write after end`（`ERR_STREAM_WRITE_AFTER_END`），栈为 `Writable.write` ← `Socket.ondata` ← `Pipe.onStreamRead`，归属到 `tests/service.test.ts` 并指向该文件最新的一例——真实 sshd 的传输用例。在带负载的全仓运行里大约六次出现一次（评审侧是七次两次），而单独跑该文件、机器空闲时从未出现。

## Decision

诊断日志流拥有它所捕获的那个子进程的生命期。`packages/dsh-ssh/tests/helpers/sshd.ts` 从 `start()` 起一直保持该日志流打开，直到 `stop()` 已让子进程消失。`stop()` 返回的 promise 只在四件事都完成后才落定：子进程已退出、管道已摘下（`child.stderr.unpipe(logStream)`）、日志流已结束、沙箱目录已删除；两个调用点都 await 它。

## Root cause

`start()` 在 `waitPort()` 一返回就结束了日志流。Node 的 `pipe()` `ondata` 处理器调用 `dest.write(chunk)` 时**不检查** `writable`——这是从当前运行的 Node 24 运行时源码里读到的——因此任何在 `end()` 之后、`finish` 摘下来源之前到达的 stderr 数据块，都会写入一个正在结束的流。该写入被拒绝为 `ERR_STREAM_WRITE_AFTER_END`，`pipe` 经 `errorOrDestroy` 重新抛出，而日志流没有 `error` 监听器，于是它逃逸为未捕获异常，被 vitest 记在当前正在跑的那个测试文件名下：整套全绿的测试被一次异步流错误判为失败。

sshd 分两批写 stderr。对该 harness 的时间戳抓取显示：约 3 ms 写入配置告警（"Deprecated option UsePrivilegeSeparation"），约 26 ms 写第二行，而端口约在 22 ms 变得可连——旧实现的 `end()` 正落在子进程自己写日志的中途，机器一忙，日志流的刷写就晚于下一个数据块。在出问题的配置下给 `Writable.prototype.write` 加探针，抓到的正是 `ctor=WriteStream writable=false` 与上面那条 `Socket.ondata` 栈，而包里只有一处这样的管道：sshd harness 的日志流。

## Alternatives considered

**给日志流挂 `error` 监听器忽略 `ERR_STREAM_WRITE_AFTER_END`。** 否决：那是把一个真实的流契约违反消音，会掩盖其它日志流里同一类缺陷，并把坏掉的收尾变成看不见的收尾。

**重试整套测试或放宽 reporter。** 否决：根因在本包的收尾而不是抖动，重试还会把第二次才通过的坏测试一起藏起来。

**摘下管道并结束日志流，但让 `stop()` 保持同步。** 否决：管道只是两个参与方之一。调用方不 await，就等于让 worker 在子进程还活着、沙箱还在删除时收尾——而那正是本决策要接管的顺序。

**干脆不捕获 stderr。** 否决：启动失败的诊断就靠这份日志，包括解释失败的那条配置告警。

## Consequences

- `TestSshd.stop()` 是异步且幂等的：第二次调用并入第一次。`tests/engine.test.ts` 与 `tests/service.test.ts` 都 await 它，因此测试文件结束前日志流与沙箱都已消失。
- 收尾仍然有界：超过两秒仍不响应 SIGTERM 的子进程被直接 KILL，而不是把整套测试挂住；关闭日志流用的是回调而不是 sleep。
- `tests/service.test.ts` 钉住该契约——`await sshd.stop()` 之后沙箱目录已不存在，而这只可能在删除发生在 `stop()` 内部时成立。
- 修好后的验证：在家族套件并发负载下连续十五次包内运行全绿且无未捕获错误；三次带负载的全仓运行既无 `write after end`，也无任何写入正在结束的流——而修复前同类运行六次里出现过一次。
- 这条陷阱适用于家族里其它 harness：日志流绝不可以在仍有活跃生产者接入时关闭，harness 的收尾必须可 await。
