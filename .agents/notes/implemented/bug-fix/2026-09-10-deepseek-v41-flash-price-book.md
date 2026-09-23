# Agent Note: DeepSeek V4.1-Flash price book refresh and the v4-pro routing fence

Status: implemented

## Problem

The fold-time spend estimate in `packages/dsh-usage/src/core/pricing.ts` carried the DeepSeek price book published on 2026-08-17: flash rows of 0.05 / 1.5 / 4.5 CNY per million tokens (cache hit / cache miss / output) off-peak, with the pro rows at 0.15 / 4.5 / 13.5.

The published page changed at 2026-09-10 12:00 Beijing: the flash rows fell to 0.02 / 1 / 4 off-peak (peak exactly double), the canonical model id became `deepseek-flash` serving DeepSeek-V4.1-Flash, and the footnote states that from 2026-09-14 12:00 Beijing every request to `deepseek-v4-pro` is served by V4.1-Flash and billed at the flash row until V4.1 Pro ships. Every official-route request priced from the stale rows therefore over-stated its estimate — by 60% on cache reads, 33% on uncached input, 11% on output (per the published cut), and by 7.5x / 4.5x / 3.4x on a `deepseek-v4-pro` session once the routing instant passes.

## Decision

- **Flash row refresh** (`src/core/pricing.ts`): `FLASH_PRICE` carries the published `deepseek-flash` numbers — cache hit 0.02, cache miss 1.0, output 4.0 CNY per million off-peak, each doubled while peaking. The retired flash ids (`deepseek-v4-flash`, `deepseek-v4-flash-vision-exp`) keep billing this row, which matches the page: they are served by V4.1-Flash.
- **Pro row kept, fenced in time**: `PRO_PRICE` is unchanged, and `priceFor(model, atMs)` applies it to a `v4-pro` id only before `V4_PRO_FOLDED_INTO_FLASH_AT_MS` (2026-09-14 12:00 Beijing, `Date.UTC(2026, 8, 14, 4, 0)`). From that instant the same id prices at the flash row. The fence sits beside the peak clock so the fold instant stays the single pricing input, and its comment names the condition that retires it (V4.1 Pro shipping with its own row).
- **Provenance in the module header**: the header records the price-book effective date (2026-09-10 12:00 Beijing), the published row ids with their version names (`deepseek-flash` = DeepSeek-V4.1-Flash, `deepseek-v4-pro` = DeepSeek-V4-Pro-0813), and the legacy-id mapping, so the next refresh starts from a stated prior state.
- **README pair**: the spend-estimate scope section documents the rows in force and the 2026-09-14 routing date instead of "the published DeepSeek V4 price book".

## Testing

`packages/dsh-usage/tests/pricing.spec.ts` pins the refreshed rows at fixed instants: flash off-peak cache hit / miss / output per million, the exact doubling at peak, the retired flash ids billing the same row, cache writes priced as uncached input on the pro row, and the routing fence — pro at Sunday 20:00 Beijing (4.5), pro at Monday 11:59:59 Beijing (9.0, still peaking), flash at Monday 12:00 Beijing (1.0, the fence instant) and Monday 20:00 Beijing (1.0). The package's 83 tests pass, and the repo-wide `pnpm typecheck`, `pnpm test`, `pnpm docs:check`, and `pnpm i18n:check` gates are green.

Replaying a live ledger day (`$DSH_HOME/dsh-usage/usage-ledger.json`) through the updated module reprices that day's `deepseek-flash` row about 41% below the amount the previous book stamped for the same tokens (cache reads dominate the mix), which is the published cut observed on real data rather than on a fixture.

## Alternatives considered

- **Refresh the numbers and leave the routing footnote out**: the smallest diff, but every `deepseek-v4-pro` fold after 2026-09-14 would over-state spend by up to 7.5x until someone revisited the file, which is exactly the failure this change exists to fix.
- **Drop the pro row now and price every `v4-pro` id at the flash row**: simplest table, but wrong for the folds that happen before the fence and for any stored bucket whose fold instant precedes it, and the row would have to be reintroduced when V4.1 Pro ships with its own published prices.
- **Fetch the price table from the docs page at runtime**: removes static staleness, but adds an outbound network dependency, a parser for a marketing page, and unbounded failure modes to a purely local ledger fold whose contract is a documented estimate — the plugin already treats the price book as a shipped snapshot.
- **Re-price persisted buckets when the book changes**: rejected when the fold-time estimate was introduced (see [the fold-time spend estimate note](../feature/2026-08-29-usage-peak-pricing-and-announce-fix.md)); the ledger stores no peak/off-peak split per bucket, so history cannot be repriced honestly.

## Consequences

- Buckets folded before this change keep their stamped cost, so a day spanning the deploy mixes old and new rows; the over-statement is bounded by the deploy hour and disappears at the next local day.
- The fence is time-sensitive in the other direction: if V4.1 Pro ships with a published row and this file is not revisited, `deepseek-v4-pro` folds would under-price. The constant's comment states the condition for removing it.
- Relay traffic (ZenMux, SiliconFlow) stays unpriced as before — only the official DeepSeek family has a price book.
