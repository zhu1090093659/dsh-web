# Agent Note: 为 bridge flow 套件引入回绝栅栏与具名静默窗口

Status: implemented

## Problem

`packages/dsh-remote-bridge/tests/relay-bridge-flow.spec.ts` 用固定 sleep 观察流控：`sleep(20)` 等一次 pause 落地、`sleep(10)` 等一个未知控制帧被忽略，另有四处 `sleep(QUIET_MS)`（`QUIET_MS = 40`）静默窗口。

这带来两个代价：settle sleep 是猜的——负载高的 runner 上 pause 可能在 20 ms 之后才落地，作为 held 采样到的帧数随后继续增长，测试因此与连接器行为无关地变红；同时 `pnpm test:standards` 的 `no-arbitrary-sleep` 规则给该文件记了 13 处违规（baseline 0 -> 13），推送前整条门禁因此变红。

## Decision

- 该套件改为对证据同步而不是对时间同步，与同目录的 [loopback abort 轮询](2026-09-08-loopback-abort-poll.md)（用有界轮询取代固定 sleep）属于同一个决定的另一处落地。新增 `fence(bridge)`：发一个连接器不服务的路径（`REFUSED_PATH`，被连接器当场以 404 回绝、不向上游拨号）的 `req` 帧，并等待它的 `res` 应答。控制帧与 payload 帧走同一条 bridge socket 且按序到达，因此这条应答证明它之前的帧都已被处理、更早写的帧都已到达：在 fence 之后读到的计数不会再被更早写出的帧改变。
- 三个 pause 测试与 cancel/close 测试的 held 计数都在 fence 之后采样；未知帧测试改由紧随其后的请求充当同一道证明，并额外断言那个未知帧从未被应答。
- 保留下来的 `expectQuiet` 窗口断言「被暂停的流在 `QUIET_MS` 内保持安静」：这个窗口本身就是被测性质，而不是等某个工作完成；按[业务测试纪律门禁](2026-09-16-business-test-discipline-gates.md)的 `test-standards-allow` 约定，带 marker 的是 `expectQuiet` 内部那行 `setTimeout(resolve, QUIET_MS)`，四处调用点本身保持原样。
- 两个 stand-in host 内的 `setInterval` 同样带标注：那是假宿主自己的时钟，没有测试等待它；`waitFor` 的轮询行也带标注，说明它就是规则点名的 bounded `waitFor`，而不是固定时长 sleep。
- 该文件的 `no-arbitrary-sleep` 计数回到 0，baseline 无需重录。

## Alternatives considered

- 给 13 行全部加 allow marker、保留 sleep：否决——marker 记录例外，但消除不了那次猜测，settle sleep 正是该规则要挡的 flake。
- 把 settle sleep 从 20 ms 调大：否决——同一个猜测换更大的常数，且每次运行都照付。
- 用第二道 fence 取代静默窗口：否决——fence 只能证明它之前写了什么，证明不了之后不会再有定时驱动的写入；「不再发生」只有有界窗口能断言。
- 用 `vi.useFakeTimers()` 推进时间：否决——该套件驱动真实 socket 与真实上游时钟，冻结定时器会停掉断言所观察的 I/O。
- 把定时原语搬进 support 模块让门禁扫不到：否决——那等于用位置规避规则，例外应当留在读者遇到它的地方并写明理由。

## Consequences

- 该套件变红重新等于连接器行为出错，而不是 runner 慢。
- fence 的代价是每次 pause/cancel 断言多一次被回绝的请求：不向上游拨号，只走一个 bridge socket 往返。
- 静默窗口仍按 40 ms 计（四处），套件为证明「安静」付出的时间上限不变。

## Testing

- 在 `packages/dsh-remote-bridge` 内 `npx vitest run tests/relay-bridge-flow.spec.ts`：7 tests 全绿。
- 在 `packages/dsh-remote-bridge` 内 `npx vitest run`：79 files / 1083 tests 全绿。
- `pnpm test:standards`：OK，no file gained violations（此前该文件 13 处）。
- `pnpm test`：exit 0。
- 改动落在 commit 9073b3be8（"test(remote-bridge): fence the bridge flow waits and name the quiet window"）。