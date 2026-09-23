# Agent Note: cron 单值步长、git 八进制转义与交接行 key

Status: implemented

## Problem

三个读者报告的缺陷，都落在本可被测试钉住、却没有任何测试覆盖的路径上：

1. `dsh-task-board` 的 `parseField` 把带步长的单值当作单值处理：`5/15` 得到 `low = high = 5`，步进循环
   只产出 `5`。标准 cron 把它读作"从 5 起步进 15 到字段上限"（5、20、35、50），因此这样写的计划会静默
   变成每小时跑一次而不是四次，且没有任何报错（#1493）。
2. `dsh-git-graph` 的 `extractBlockedPaths` 用 `replace(/\\(.)/g, '$1')` 逐字符反转义。git 默认的
   `core.quotePath` 会把每个非 ASCII **字节**写成八进制转义，于是 `ämne.txt` 以 `"\303\244mne.txt"`
   到达，逐字符处理把两个转义拼成了 `303244`——覆盖冲突列表里的文件名变成乱码（#1491）。
3. `dsh-task-board` 的任务详情用引用字符串本身作为交接引用行的 key，重复引用即产生重复 React key 与
   控制台告警（#1492）。

## Decision

1. 带步长的单值现在延伸到字段上限（`high = stepRaw === undefined ? low : max`）。不带步长的单值、
   `*/step` 形式、区间与列表保持原语义，既有的 `low < min || high > max || low > high` 校验继续拒绝
   越界字段。
2. `extractBlockedPaths` 改由新的 `decodeGitQuoted` 解码：八进制串按字节收集，C 风格转义
   （`\a \b \f \n \r \t \v`）转成对应控制字节，其它被转义字符按字面保留，最后用
   `TextEncoder`/`TextDecoder` 统一按 UTF-8 解码。**未采用** issue 建议的
   `String.fromCharCode(parseInt(oct, 8))`：它把每个字节映射成 Latin-1 码位，`\303\244` 会变成
   `Ã¤`——依旧是乱码，只是形状不同。
3. 交接引用行改用 `${reference}-${index}` 作 key，既保持每行稳定，也不丢弃或重排重复项。

## Verification

- `pnpm --filter @linxin666/dsh-client-ui-git-graph test`：10 个文件、147 条测试通过（新增两条：八进制
  UTF-8 解码、常规转义）。
- `pnpm --filter @linxin666/dsh-client-ui-task-board test`：36 个文件通过、339 条测试通过、1 条跳过
  （新增两条：`5/15` -> {5,20,35,50} 且 `2/6` -> {2,8,14,20}，`*/15` 与 `1-30/5` 不变；重复引用渲染
  两行且无 `same key` 控制台错误）。
- 两个包的 `typecheck` 均通过。

## Alternatives considered

让 git 以 `-c core.quotePath=false` 运行被否决：为了一个显示路径而改变所有 git 调用的输出契约，而且
带引号的输出仍可能从其它命令到达。

用 `Buffer.from(bytes)` 解码被否决：`src/core/` 同时编译进 host 与浏览器 program，`Buffer` 只在 Node
可用，而 `TextEncoder`/`TextDecoder` 两边都有。

对引用列表去重而不是加 key 被否决：那会静默改变用户写进冻结块里的内容。

## Consequences

`5/15` 这类表达式现在每小时触发四次，而此前只触发一次——对写过它的人而言这是真实的行为变化，也是该
语法的本意。非 ASCII 路径在覆盖冲突提示中正确显示。git 路径解码器现在是面向字节的，未来若再遇
`core.quotePath` 的怪癖只需扩展一处。
