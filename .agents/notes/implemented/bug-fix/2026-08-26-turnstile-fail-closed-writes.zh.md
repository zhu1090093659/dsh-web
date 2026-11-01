# Agent Note: 市场写入接口的 Turnstile 失败关闭

Status: implemented

## Problem

`/api/like` 与 `/api/install` 把 Turnstile 挑战当作唯一的防滥用闸门（device_fp、install_id、asset_id 均为客户端自报、仅做格式校验），但当 `TURNSTILE_SECRET` 绑定缺失时 `verifyTurnstile` 返回 `true`——任何网络客户端都能匿名写入、以攻击者控制的键值在 D1 建行，并操纵对外公开的统计数据。该绑定此前只由 CI 里的一个条件步骤接入（GitHub secret 为空时 `deploy-market.yml` 跳过 `wrangler secret put`），而 `scripts/deploy-market` 从不校验它，于是一个变量缺失就会静默摘掉仓库规则要求的闸门。只读审计完整追踪了该路径，并确认没有任何限流或 manifest 成员校验作为兜底。

## Decision

worker 改为失败关闭：绑定缺失时 `verifyTurnstile` 返回 `false`，两个写接口按已配置部署中令牌被拒的相同方式返回 403（`captcha-required` / `captcha-invalid`）。`scripts/deploy-market` 新增部署后步骤：当部署环境带有 `TURNSTILE_SECRET` 时先刷新绑定，再通过 `cf workers secrets list` 核验 worker 确实持有该绑定，否则让部署立即报错失败。部署工作流在部署前断言仓库 secret 已配置，取代原先的条件 put 步骤（put 改由部署脚本执行）。OpenAPI 摘要去掉「when configured」限定语，`market-worker.test.mjs` 新增测试钉死失败关闭行为：绑定缺失时两个端点都返回 403 且 D1 完全不被触碰。

## Alternatives considered

保留失败开放、仅补文档警告的方案被否决：该闸门是仓库级规则，警告无法阻止静默错配。在路由分发处以专用 503 `captcha-unconfigured` 拒绝的方案被否决：复用现有 403 `captcha-*` 响应可保持客户端处理不变，且部署期断言比运行期状态码更早、更响地暴露错配。改用 Cloudflare API 读取 worker 设置来核验绑定的方案被否决：信号相同但活动部件更多。

## Consequences

对已配置 secret 的部署行为不变；未配置的部署现在拒绝写入而非匿名放行，secret 缺失会让 CI/部署失败而非静默上线。本地冒烟写接口需要注入桩绑定（测试套件已如此）。部署现在要求 Cloudflare token 能读取 secret 列表，部署用 token 本就具备该权限。闸门决策本身不变——见[创意工坊安装量与 npm 指标](../feature/2026-08-26-workshop-install-and-npm-metrics.md)（交叉引用，非取代）。

## Testing

`node --test scripts/market-worker.test.mjs`（30 项全过，含两个端点新增的失败关闭用例）、`node --check scripts/deploy-market`、`actionlint .github/workflows/deploy-market.yml`。
