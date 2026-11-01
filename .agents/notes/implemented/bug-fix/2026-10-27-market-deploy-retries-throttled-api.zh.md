# Agent Note: Deploy Market 通道对被限流的 Cloudflare API 做重试，而不是在第一个 429 上失败

Status: implemented

## Problem

Deploy Market 通道在 dev 上红了三次，每次都在 `node scripts/deploy-market` 开始约一秒后失败：run 40350674320（2026-10-26 15:34）、run 40367640238（2026-10-26 17:20）、run 40430514377（2026-10-27 01:05）。日志是 `GET /accounts/***/workers/services/dsh-market` 的 `Received a malformed response from the API` 加 `-> 429 Too Many Requests`，随后 `deploy-market: wrangler deploy failed (exit 1)`。当时这条通道跑的是 wrangler CLI，今天跑的是 `cf`。

通道发出去的请求本身没有问题。这个 429 没有带 `Retry-After` 头，而 wrangler 只在该头存在时才退避（`wrangler-dist/cli.js` 62987 与 65214），于是第一个被限流的响应就结束了整条通道。

客户端版本同样不是变量。最后一次绿跑（40285936221，2026-10-26 07:27）装的是 wrangler 4.152.0，失败的那几次装的是 4.153.0，但两个 bundle 里 `workers/services` 的调用点都是同样 14 处；差别在 API 限流了哪个请求，不在客户端。

还有一次红跑属于这段历史、但不属于本决策：run 40212351108（2026-10-25）失败得更早，在 Market consistency 步骤里，已单独修复。

## Decision

`scripts/deploy-market` 在受限的重试策略下运行每一次 `cf` 调用：`MAX_ATTEMPTS = 4`（第 48 行），即首次尝试加最多三次重试，重试之间是 `RETRY_BACKOFF_MS = [5000, 20000, 60000]`（第 51 行）。

`classifyTransientFailure`（第 112 行）拿子进程的失败文本去匹配 `TRANSIENT_SIGNATURES`（第 72 行），认得 HTTP 429、两个 CLI 各自的 HTTP 5xx 打印形状、文本 `malformed response from the API`，以及 `ECONNRESET` / `ETIMEDOUT` / `EPIPE` / `socket hang up`，加上 Node 网络层对同一个失败的文案：`fetch failed` / `FetchError: request to <url> failed`。前者正是 cf 打印的东西——undici 把没能完成的连接拒绝成一个 message 恰为 `fetch failed` 的 `TypeError`，而 cf 的错误框只打印这一句 message，因为点名 syscall 的 cause（`ECONNRESET`、`ENOTFOUND`、`UND_ERR_*`）只有在 cf 带 `DEBUG` 运行时才进日志；后者是 node-fetch 客户端对同一个失败的拼法。这两个 token 都不会出现在配置、鉴权、内容或迁移类失败里，所以这一对留在网络层，与上面 wrangler 的 socket 文案并列，报的是同一个 `socket-error` 原因。5xx 形状是 wrangler 的（`-> 503`、`HTTP 522`、`statusCode: 500`、`Status code: 503`）加上 cf 的类型化命令渲染，后者有两种形态：`<status> <text> · HTTP <path>`，以及 cf 的固定状态文案表没有该码条目时的 `<status>  · HTTP <path>`（双空格，520-527 这一类就渲染成空文案）。这两种形态的状态都不出现在行内别处——既没有 `HTTP 5xx`、也没有 `Status code:` 标记——所以 wrangler 形状的那条分支两种都抓不到，由一条锚定 cf ` · HTTP ` 分隔符的分支统一覆盖。一条都不匹配的失败走快速失败路径，报的仍是逐字节相同的那条消息（第 268 行）。

预算用尽时，失败消息带上原因、尝试次数、响应里带的 Cloudflare Ray ID，以及被捕获输出的有界 200 行尾巴（`failureMessage`，第 250 行；`createTail`，第 132 行）。子进程的 stdout 与 stderr 经中继实时留在 job 日志里，同一份文本同时留在有界环形缓冲中（`spawnAttempt`，第 177 行），因此最终成功的那次重试之后，先前几次的日志仍然可读。

通道里其余部分一律不动：`--cf` 选项、`TURNSTILE_SECRET` 与 `ASSET_ATTEST_SECRET` 的失败关闭闸门、siteverify 配对探针、`market-build --check` 预检、D1 迁移步骤以及每一个退出码，行为都与加重试之前一致。

## Testing

`scripts/deploy-market.test.mjs` 通过注入的尝试与等待驱动这套策略，不睡觉也不联网：它证明重试后成功、预算耗尽时带出 Ray ID 与捕获证据、以及非瞬时失败恰好只尝试一次。另有两个用例跑真实子进程，覆盖输出中继与 secret 绑定所用的 0600 文件。

这次改动要求的验证：`pnpm test:scripts`、`pnpm test:standards`、`pnpm typecheck`，以及改动推送后第一次 Deploy Market 运行。

## Alternatives considered

- **把 wrangler 钉在最后一次绿跑的版本上。** 否决：证据显示与版本无关，两个 bundle 的 `workers/services` 调用点都是同样 14 处；钉版只会把上游修复一起冻住，而碰不到限流本身。
- **把重试搬到 workflow 步骤层。** 否决：步骤级重试会把 D1 迁移、部署与 secret 刷新整条重跑一遍，还会重跑 `market-build` 预检，而为的只是一个被限流的 HTTP 响应。
- **现在就把通道迁到 `cf` CLI。** 属于那次改动不改、而非永久否决：它需要为 `market/worker` 准备 `cloudflare.config.ts`，并把 wrangler 装成该目录的 devDependency，是个更大的改动，只有在有界重试救不回通道时才重新考虑。这次迁移后来落地了：通道今天跑在 `cf` CLI 上（[市场部署车道改用 cf CLI](../process/2026-10-27-cf-cli-market-deploy-lane.zh.md)）。

## Consequences

- 子进程输出里任何一处孤立的 `429` 都可能先烧掉最多 85 秒重试（5 + 20 + 60），然后才浮现同一个失败，而它从不会把失败刷成绿。多出来的等待远在通道 15 分钟超时之内。
- 管道化子进程输出会让本地手工运行这个脚本时失去 CLI 的 ANSI 颜色；CI 不受影响。
- 残余风险直说：如果这个 429 是账号级的持续性限流而不是瞬时限流，重试救不回通道。通道后来已迁到 `cf` CLI，重试仍然守在每一次调用前面。
