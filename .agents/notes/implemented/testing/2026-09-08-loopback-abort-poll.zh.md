# Agent Note: loopback abort 断言改用轮询替代固定 sleep

Status: implemented

## Problem

`packages/dsh-remote-web-ui/tests/loopback-proxy.spec.ts` 用固定 80 ms 睡眠后断言「外层客户端中断会停掉内层请求」。代理是异步传播该中断的，在负载较高的 runner 上复位可能落在这个窗口之后：同一条断言在本地 `pnpm -r test` 里失败过一次、单独运行 6/6 通过，随后把文档推送的 CI 运行打红（run 34240029467，第 93 行 `expected false to be true`）。一条随 runner 负载摇摆的红色套件，会训练维护者重跑而不是读日志。

## Decision

- 第一个用例改为用有界 `waitFor(predicate, 2000, 10)` 轮询中断标志并断言轮询结果：断言依旧严格——真实回归仍会在截止时间后失败——但时序不再取决于机器负载。
- 另外两个用例保持原样：截断响应用例本来就等响应事件，keep-alive 用例等请求 promise。
- 辅助函数写明了存在原因（异步传播 + 负载型 runner），避免后来者又把它简化回固定 sleep。

## Alternatives considered

- 把固定睡眠调大（例如 80 ms 改 500 ms）：否决——只是挪动阈值，更慢的 runner 依旧会失败，而且每次运行都变慢。
- 失败后整条用例重试：否决——重试会掩盖真实回归，并让易抖路径的成本翻倍。
- 跳过用例或放宽断言：否决——中断传播正是被测行为，放宽等于删掉当初抓到竞态的覆盖。

## Consequences

- 套件不再依赖 runner 负载，红色 CI 重新代表真实缺陷。
- 中断确实永不到达时最多多花两秒；正常路径在标志翻转后立刻返回（毫秒级）。

## Testing

- 在 `packages/dsh-remote-web-ui` 内 `pnpm vitest run tests/loopback-proxy.spec.ts`：连续 10 次全绿。
- 变更后的工作树在当初复现抖动的并行负载下跑两遍 `pnpm test`：均全绿；`pnpm typecheck` 全绿。
- CI run 34240029467 是被修复的失败证据；dev 上后续的 CI 运行是验收。
