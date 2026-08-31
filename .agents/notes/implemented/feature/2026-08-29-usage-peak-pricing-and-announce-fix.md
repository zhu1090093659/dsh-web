# Agent Note: DeepSeek peak/off-peak spend estimate and the announce id reconciliation

Status: implemented

## Problem

Two defects and one missing surface in the dsh-usage pet linkage, reported together by the user after enabling `bubbleMode: always`:

1. **The bubble never appeared.** `announceCurrent()` looked up the snapshot under the current provider id, but the id spaces disagree: sessions and `agent-default-model` carry `deepseek-official` (the live route the harness `llm-deepseek` adapter registers), while the DEEPSEEK usage adapter answered only `deepseek` (the configurable-catalog key). `snapshots.get('deepseek-official')` was always undefined — verified live against the running host: `current.provider = deepseek-official` with no snapshot row, while the probed balance sat under the separate `deepseek` catalog row.
2. **Even a successful announce was invisible.** The pet contract clamped the announcement TTL to 60 s with a 10 s default, while the usage poll cycle defaults to 60 s — an `always` bubble would flash at most 10 s per minute.
3. **No spend or peak visibility for the official DeepSeek family.** DeepSeek's V4 peak/off-peak pricing (effective 2026-08-17: Beijing Monday-Friday 09:00-12:00 and 14:00-18:00 peak at double price, everything else half) affects every official-route request, and the user asked to see today's estimated spend plus the current period, and plan usage for coding-plan/subscription providers in the bubble.

## Decision

- **Id reconciliation at the adapter layer** (`src/core/adapters.ts`): the DEEPSEEK adapter now serves both `deepseek` and `deepseek-official`, and `isDeepSeekProviderRoute()` keys family behavior (credential env fallback via the `llm-deepseek` settings section, fold-time pricing) off adapter identity rather than a hardcoded id. `announceCurrent()` additionally falls back to the adapter-family snapshot when the current route id has none of its own, so a catalog/live id drift can never silence the bubble again.
- **Poll-cadence TTL** (`src/host/usage-service.ts` + pet contract): the announcer declares `ttlMs = 2 x poll interval + 30 s` (capped), and the pet contract ceiling moves from 60 s to 2 h (`ANNOUNCE_MAX_TTL_MS`) — an `always`-mode bubble stays continuous across polls, while a dead source still unmounts within one missed refresh.
- **Fold-time spend estimate** (`src/core/pricing.ts`): `UsageTokenTotals` gains a `cost` number stamped when the usage folds, priced from the published V4 price book (flash/pro rows, CNY per million tokens) in the billing period at the fold instant. DeepSeek official routes only; other families stay 0 so the sum is never a mixed-currency total. Persisted buckets keep their old pricing (no retroactive re-pricing); `reviveTotals` restores `cost`, so reloads never double-price.
- **Cost-first bubble**: with spend today, DeepSeek announces kind `cost` (new contract member) — amount `今日 ¥x.xx`, note carrying the current period (`高峰时段 计价×2` / `空闲时段 计价减半`) plus the balance, tone `warn` while peaking. Zero-spend days fall back to the balance bubble; plan providers keep the plan bubble. The usage tab shows the peak period line (gated on the DeepSeek family being current or present today) and a today-spend row with per-provider cost suffixes.

## Alternatives considered

- **Pricing at display time from peak/off-peak token buckets**: more flexible when prices change, but it doubles every ledger bucket and still cannot reprice history (the peak split is only known at fold time). A single stamped `cost` keeps the ledger shape and matches how the provider actually billed.
- **BaseURL-based adapter matching** for unknown route ids: more general than the two-id alias, but no current route needs it (the pi-ai profiles carry their own well-known ids) and host tables drift silently; the family fallback already covers id drift.
- **Merging the `deepseek` catalog row and the `deepseek-official` live row** in the overview: they are both runtime-offered routes probing the same endpoint; hiding one would need credential-equality heuristics not worth their complexity.

## Consequences

- The spend estimate covers official DeepSeek routes only; relayed deepseek traffic (ZenMux, SiliconFlow) is unpriced, and unknown DeepSeek model ids take the flash-class row (documented in the README).
- Pet announcements older than the new ceiling contract (pre-upgrade dsh-pet + post-upgrade dsh-usage) would clamp to 60 s — both halves ship in this repository together, and the mixed-version window only shortens the bubble, never breaks it.
- Historical days before this change carry `cost: 0`; today-spend counts from the first post-update fold.
