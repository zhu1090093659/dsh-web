# Agent Note: Remaining-based quota percent and official-endpoint adapter resolution

Status: implemented

## Problem

Issue #2045 reported two gaps in `dsh-usage`:

1. On Kimi For Coding quota responses, exhausted or freshly reset windows may omit `used` and send only `limit` and `remaining`. The previous helper checked only `used / limit`, returning `undefined` and dropping the percentage text and progress bar.
2. Users who add a second account under the same vendor (for example a custom `llm-pi-ai` provider id such as `kimi-coding-2` pointed at `https://api.kimi.com/coding/v1`) were skipped by `adapterFor(route.id)` because the adapter registry previously matched only fixed catalog route ids.

## Decision

1. **Derive used percent from `remaining` when `used` is omitted.** Replace the private `usedPercent` helper with exported `quotaUsedPercent(used, remaining, limit)`: it prefers `used` when numeric and present, otherwise falls back to `(limit - remaining) / limit` clamped to `[0, 100]` whenever `limit > 0`.
2. **Resolve secondary custom route ids via trusted official HTTPS endpoints.** Add `resolveRouteAdapter(provider, baseURL)` in `packages/dsh-usage/src/core/adapters.ts`, backed by `ENDPOINT_ADAPTERS` matching lowercased hostname and pathname segment boundaries (`path === prefix || path.startsWith(prefix + '/')`) on `https:` URLs only:
   - Known catalog ids still resolve through `adapterFor(provider)` first so custom gateway overrides keep reporting `balanceSupported: false` (#1688).
   - Family-only non-key ids (`deepseek-account`) return `undefined` before endpoint matching so they never inherit API-key probing or `DEEPSEEK_API_KEY` fallbacks (#1772).
   - `UsageService.overview()`, `pollNow()`, and `routeDisplayName()` call `resolveRouteAdapter(route.id, this.routeBaseUrl(route.id))`, while `foldAliasRoutes()` and `familyUsageToday()` retain `adapterFor()` so two live accounts are neither collapsed nor merged in daily ledgers.

## Alternatives considered

- **Guessing vendor identity from substring matching on `provider` ids (for example `id.startsWith('kimi')`).** Rejected: a user naming a third-party relay `kimi-proxy` would be probed against Kimi's official endpoint, repeating #1688. Matching the verified `https:` inference origin and path prefix binds detection to the actual upstream account.
- **Unconditionally probing resellers or custom HTTP gateways.** Rejected: third-party resellers do not implement official vendor balance or plan APIs and risk credential leakage.

## Consequences

- Quota windows reporting `limit` + `remaining` without `used` display `0%` when unspent, `100%` when `remaining === 0`, and accurate intermediate ratios.
- Any number of configured accounts per vendor pointing at official HTTPS endpoints probe independently with their own credentials and display under their own route names.

## Testing

- `packages/dsh-usage/tests/adapters.spec.ts`: verifies `quotaUsedPercent`, Kimi `remaining`-only responses, `resolveRouteAdapter` mappings across vendors, HTTPS/path boundary rejections, and `#1772`/`#1688` guards.
- `packages/dsh-usage/tests/usage-service.spec.ts`: verifies two concurrent Kimi accounts (`kimi-coding` and `kimi-coding-2`) probe independently and compute percentages when `used` is omitted.
- `pnpm --filter @linxin666/dsh-usage test`: 14 files, 206 tests pass; `pnpm --filter @linxin666/dsh-usage typecheck` passes.
