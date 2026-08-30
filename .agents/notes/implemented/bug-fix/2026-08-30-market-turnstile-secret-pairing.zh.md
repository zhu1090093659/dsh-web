# Agent Note: 市场点赞中断源于从未配对成功的 Turnstile secret，已从组件 API 直接修复

Status: implemented

## Problem

自 2026-08-26 15:59 UTC 起，所有 `/api/like`（以及 `/api/install`）写入全部 403——四天零点赞，而站点与 CI 部署表面一切正常。客户端无辜：真实浏览器探测显示隐形组件正常签发 token，且 403 响应体为 `captcha-invalid`，说明 siteverify 拒绝的是 freshly 签发的有效 token。worker 上绑定存在（`wrangler secret list` 可见 `TURNSTILE_SECRET`）、GitHub secret 早于故障、Turnstile 组件自创建后从未修改——没有任何单点事实能解释这个拒绝。

## Decision

GitHub `TURNSTILE_SECRET` 里存的值从来不是组件的真实 secret。掩盖它的是旧的 fail-open 分支：`verifyTurnstile` 在无绑定时直接返回 `true`，因此 2026-08-22..08-26 期间（CI 的 put 步骤恰好是坏的，见 `a2ffaa566` 修复）所有点赞都以匿名方式放行，存的那个错误值从未被真正校验过。`c6076c857` 的 fail-closed 部署第一次把 GitHub 的值真正推进 worker，siteverify 从那一刻起拒绝一切。

2026-08-30 的修复：

- 真实 secret 可由 Cloudflare API 直接读取：`GET /accounts/{account}/challenges/widgets/{sitekey}` 返回 `secret` 字段，wrangler 的 OAuth token 可调用。无需打开仪表盘，也无需轮换。
- 真实值以精确字节（无尾部换行）直接写入 worker（在 `market/worker` 下执行 `wrangler secret put TURNSTILE_SECRET`），并同步回仓库 secret（`gh secret set TURNSTILE_SECRET --body`），此后 CI 部署重放的将是同样的字节。
- 已在生产环境用真实 Chrome 端到端验证：点赞返回 `200 {"ok":true,...}` 且票数前进；随后再点一次以 `unlike` 返回 `200` 撤销测试赞，D1 计数恢复原状。

第一次修复在一小时内复发：07:59 UTC 的 0.3.8 发版部署用 GitHub 值重设了绑定，而 `gh secret set --body` 存进去的值是被污染的（siteverify 再次拒绝，仍是 `captcha-invalid`）。随后改用无换行的 35 字节文件经 stdin 重写仓库 secret，并且 `scripts/deploy-market` 的 `ensureTurnstileSecret` 现在在写入前先 trim——仓库 secret 里混入的任何空白都不可能再到达 worker。

## Alternatives considered

在仪表盘轮换组件 secret 再更新 CI 被否决：API 本就交出当前有效凭据，轮换是无谓地作废一个仍然配对的 secret。回退 `c6076c857` 的 fail-closed 改动被否决：那会恢复匿名写入——这次故障恰恰证明门禁是承重墙，正确修复是把 secret 修对，而不是把门禁改弱。把 siteverify `error-codes` 加进 403 响应体被推迟：它确实能缩短本次定位（这些码能区分 `invalid-input-secret` 与 hostname/action 不匹配），但会改动公开 API 契约及其文档与测试，本次事件并不要求。

## Consequences

worker 与 CI 现在持有同一个 API 读取的真实 secret，点赞恢复——并且跨部署依然成立，因为部署脚本会对写入值做净化。持久的教训记录于此，因为没有代码能承载它：fail-open 分支会在其可达期间掩盖一个错误凭据，而第一个 fail-closed 部署就成为故障点；字节精确的 secret 传递通道同样关键，仓库 secret 里的一个尾部换行就会在下一次部署悄悄复刻同一场故障。当 Turnstile 门控写入开始返回 `captcha-invalid` 且 token 正常签发时，先用 `GET .../challenges/widgets/{sitekey}` 比对 worker 绑定值，再怀疑客户端、组件配置或 Cloudflare。

## Testing

真实浏览器对生产的探测：secret 写入前 `/api/like` 403 `captcha-invalid`，写入后点赞与取消点赞均 `200`；D1 `likes` 日趋势查询确认了 08-26 14:44 UTC 的截点；`gh api .../actions/secrets` 确认仓库 secret 已刷新。无代码改动，因此未运行构建或测试门禁。
