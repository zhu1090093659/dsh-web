# Agent Note: 市场点赞中断源于上传了空的 Turnstile secret，已修复并加入部署自检

Status: implemented

## Problem

自 2026-08-26 15:59 UTC 起，所有 `/api/like`（以及 `/api/install`）写入全部 403——四天零点赞，而站点与 CI 部署表面一切正常。客户端无辜：真实浏览器探测显示隐形组件正常签发 token，且 403 响应体为 `captcha-invalid`，说明 siteverify 拒绝的是 freshly 签发的有效 token。绑定存在（`wrangler secret list` 可见）、GitHub secret 字节正确（长度/指纹探针）、Turnstile 组件自创建后从未修改——没有任何单点事实能解释这个拒绝。

## Decision

根因：`scripts/deploy-market` 的 `sh()` 辅助函数在调用 `spawnSync` 时同时给了 `stdio: 'inherit'` **和** `input: <secret>`。当 stdin 不是管道时，node 会静默丢弃 `input`（本地复现：子进程收到 `""` 且无任何报错），于是 `wrangler secret put TURNSTILE_SECRET` 读到空 stdin，上传了**空绑定值**，却仍然报告 `Success!`。自该步骤随 `c6076c857`（2026-08-26 的 fail-closed 改动）引入以来的每一次 CI 部署都在重新清空绑定；在 fail-closed 门禁之下，所有带 token 的写入随即全部拒绝。用 shell 手动执行的 `wrangler secret put`（真管道）能临时恢复点赞，而下一次部署又无声地把它打空——这正是修复尝试期间故障看起来"时好时坏"的原因。

2026-08-30 的修复：

- `sh()` 在给定 `input` 时改用 `['pipe', 'inherit', 'inherit']` 作为 stdio，secret 才能真正送达 wrangler。
- 部署对 put 结果做端到端核验：用绑定值加假 response token 探测 siteverify，期望 `invalid-input-response`；若为 `invalid-input-secret` 则大声使部署失败，而不是上线一个写入全死的 worker。
- worker 的 403 响应现在携带 `captcha_error_codes`（siteverify 错误码，外加合成的 `missing-secret-binding`），一次请求即可从客户端侧判定死绑定。
- GitHub `TURNSTILE_SECRET` 已同步为组件真实 secret，从 `GET /accounts/{account}/challenges/widgets/{sitekey}` 机器读取（wrangler 的 OAuth token 可调用）。
- 已在生产环境用真实 Chrome 端到端验证：点赞与取消点赞均 `200` 且票数前进、可还原；部署后验证在部署工作流完成之后进行，而不是之前。

## Alternatives considered

回退 `c6076c857` 的 fail-closed 改动被否决：那会恢复匿名写入——这次故障恰恰证明门禁是承重墙。把 wrangler 钉在恰好能工作的版本被否决：坏的是 spawn 契约而非 wrangler 版本，歧义仍会复发。改用 Cloudflare REST API 更新 secret 被否决：管道修好后那是多余的面。在仪表盘轮换组件 secret 也被否决：API 本就交出当前有效凭据，轮换是无谓地作废一个仍然配对的 secret。

## Consequences

CI 部署现在能保住 Turnstile 配对；一旦回归，部署会带着 siteverify 错误码大声失败，而不是无声地停掉点赞。worker 的 403 能自述失败环节。持久的教训：`spawnSync` + `input` + 继承的 stdin 会无声失败——凡是这样传 payload，都要核实子进程真正收到了什么；fail-closed 门禁会把一个坏掉的部署步骤放大成全站故障，因此部署必须核验门禁健康度，而不只是步骤退出码。

## Testing

本地 `spawnSync` 复现（旧写法子进程收到 `""`，新写法收到 payload）；`node --test scripts/market-worker.test.mjs`（36 通过）；真实浏览器对生产的端到端验证（点赞/取消点赞 `200`）；部署日志中的配对检查通过（`invalid-input-response`）；D1 `likes` 日趋势查询确认 08-26 14:44 UTC 的截点。
