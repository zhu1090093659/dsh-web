# Agent Note: 基于剩余量的配额百分比回落与官方端点适配器识别

Status: implemented

## Problem

Issue #2045 反馈了 `dsh-usage` 中的两个问题：

1. 在 Kimi For Coding 的配额响应中，额度刚重置或完全用尽时接口可能省略 `used` 字段、仅返回 `limit` 与 `remaining`。原有计算只读取 `used / limit`，会返回 `undefined` 导致前端百分比文本与进度条消失。
2. 当用户为同一厂商添加第二个自定义 route id 的账号（例如 `llm-pi-ai` 中新增 `kimi-coding-2` 并配置 `baseURL: https://api.kimi.com/coding/v1`），原有 `adapterFor(route.id)` 仅按固定目录 id 匹配，导致第二账号完全不参与套餐与余额探测。

## Decision

1. **缺失 `used` 时以 `limit - remaining` 反推已用比例。** 将内部 `usedPercent` 替换为导出的 `quotaUsedPercent(used, remaining, limit)`：优先使用有效数值 `used`；当 `used` 缺失且 `limit > 0`、`remaining` 有效时，按 `(limit - remaining) / limit` 计算并钳位至 `[0, 100]`。
2. **通过受信任官方 HTTPS 端点解析自定义第二账号。** 在 `packages/dsh-usage/src/core/adapters.ts` 新增 `resolveRouteAdapter(provider, baseURL)`，基于 `ENDPOINT_ADAPTERS` 对 `https:` URL 执行小写域名与路径前缀边界匹配（`path === prefix || path.startsWith(prefix + '/')`）：
   - 已知目录 id 仍优先走 `adapterFor(provider)`，确保已修改为第三方网关 `baseURL` 的目录行继续维持 `balanceSupported: false`（#1688）。
   - `familyOnlyIds`（如 `deepseek-account`）在进入端点匹配前直接返回 `undefined`，防止即便配置了 `api.deepseek.com` 也误继承 API-key 探测与 `DEEPSEEK_API_KEY`（#1772）。
   - `UsageService.overview()`、`pollNow()` 与 `routeDisplayName()` 改用 `resolveRouteAdapter(route.id, this.routeBaseUrl(route.id))`；而 `foldAliasRoutes()` 与 `familyUsageToday()` 保留 `adapterFor()`，避免两条独立账号被错误折叠或混算当日用量。

## Alternatives considered

- **按路由 id 子串启发式猜厂商（例如 `id.startsWith('kimi')`）。** 否决：若用户把中转命名为 `kimi-proxy` 会向官方接口发请求并错配账户，重演 #1688。按实际 `https:` 推理域名与路径前缀匹配才能绑定真实上游账户。
- **放宽到任意 HTTP 或第三方中转域名。** 否决：中转站并不具备官方余额/套餐接口，且存在凭据暴露风险。

## Consequences

- 仅返回 `limit` 与 `remaining` 而不带 `used` 的配额窗口能正确显示 `0%`、`100%` 及中间使用百分比。
- 同一厂商配置任意多个自定义 id 账号（指向官方 HTTPS 端点）时，各自独立探测凭据并展示独立行。

## Testing

- `packages/dsh-usage/tests/adapters.spec.ts`：覆盖 `quotaUsedPercent`、Kimi 缺 `used` 响应、`resolveRouteAdapter` 各厂商端点匹配、非 HTTPS 与路径边界拒绝及 `#1772`/`#1688` 护栏。
- `packages/dsh-usage/tests/usage-service.spec.ts`：覆盖同时配置 `kimi-coding` 与自定义 `kimi-coding-2` 时各自使用独立凭据探测并解析仅含 `remaining` 的响应。
- `pnpm --filter @linxin666/dsh-usage test`：14 个文件、206 个测试全部通过；`pnpm --filter @linxin666/dsh-usage typecheck` 通过。
