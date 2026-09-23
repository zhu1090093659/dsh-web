# Agent Note: dsh-usage drops the pet bubble; the collapsed sidebar strip carries the session usage

Status: implemented

Partially supersedes [the usage statistics plugin](../feature/2026-08-29-usage-statistics-plugin.md) (its pet-linkage decision) and [the DeepSeek peak pricing and announce fix](../feature/2026-08-29-usage-peak-pricing-and-announce-fix.md) (its announce/bubble parts; the adapter identity and fold-time pricing decisions stay). Leaves [the pet announcement contract](../feature/2026-08-29-pet-announcement-bubble.md) intact but without its bundled consumer. Its collapsed-summary surface was later removed by [usage sidebar surface removed](2026-09-18-usage-sidebar-surface-removed.md), which also updates the #1592 facts of [issue batch 1587-1600](../bug-fix/2026-09-16-issue-batch-1587-1600-fixes.md).

## Problem

dsh-usage announced the current session provider's status to the pet through `ctx.pet.announce(...)` — a cost/balance/plan bubble with a usage fallback, tuned by the `bubbleMode` setting. That made dsh-usage the pet contract's only bundled consumer and coupled the two plugins: the usage service carried a whole announce pipeline (payload builders, tone mapping, TTL math, family-spend resolution, change-detection signatures), the settings UI carried a pet-bubble select, and every announce fix crossed package boundaries. The user asked to decouple the plugins: no usage facts on the pet bubble; instead, the sidebar usage area shows the current session provider's today usage while the panel is collapsed.

## Decision

1. The announce pipeline leaves dsh-usage entirely: `USAGE_ANNOUNCE_SOURCE`, `buildAnnouncement`, `buildLedgerAnnouncement`, `planTone`, `formatMoney`, the host's zh-convention `formatTokens`, `announceCurrent`, and the `bubbleMode` config (schema, `resolveConfig`, the settings select, zh/en/ru copy) are removed. dsh-pet is untouched: its `pet.announce` contract stays available to any sibling plugin, with its docs and code comments no longer naming dsh-usage as the consumer.
2. The overview document carries the strip-ready current view: `current.displayName` (snapshot first, route-derived otherwise) and `current.today` — today's ledger totals for the provider's adapter family, so aliased routes of one account (`deepseek` / `deepseek-official`) fold together; absent on a day without usage. Both fields are optional so an older host document still renders; the client derives the same facts from the providers list and the today rows when they are missing.
3. Collapsed, the sidebar panel renders a one-line strip under the entry row — provider name, today's tokens (the section's k/M/B `formatTokens`), the call count, and the priced cost when the family is priced — instead of nothing. The strip stays silent with no session provider or no usage today, and hides in the 56 px rail. The new `sidebar-summary` part is registered in the semantic-attrs contract.
4. Polling cadence relaxes with the surface: 10 s expanded, 30 s collapsed, paused whenever the page is hidden (previously: only while expanded and visible). Collapsing refreshes once immediately so the strip opens on fresh data.
5. Old configs carrying `bubbleMode` are harmless: the schemastery schema drops unknown keys, so no migration is needed.

## Alternatives considered

- Keeping the bubble as an opt-in (default off). Rejected: the coupling itself was the problem — the announce pipeline, its tests, and the cross-package fix surface would all stay for a default-dead feature.
- Seating the summary inside the entry row's label area. Rejected: the row is a single-line nav idiom; the strip is a separate row under it, the same anchor the expanded panel uses.
- Reusing the bubble's zh-convention 万/亿 token formatting for the strip. Rejected: the sidebar speaks the section's formatting (k/M/B), and the host no longer ships any display copy — the strip renders from structured fields and locale keys.

## Consequences

- dsh-usage and dsh-pet no longer share a runtime contract; each evolves independently. The pet keeps its announce contract and loses its only bundled announcer — its bubble stack renders session-driven bubbles only until another plugin announces.
- The session usage fact moved from an ephemeral TTL-bound bubble to a stable sidebar place that also survives the pet being disabled, at the price of one overview fetch per 30 s while collapsed and visible.
- `deepseekPeriodAt` lost its last host consumer (the section computes the period client-side), so it stays in core pricing for the fold-time estimate only.

## Testing

- `packages/dsh-usage/tests/usage-service.spec.ts`: the announce describes are gone; a new current-view describe covers the strip-ready fields, the adapter-family fold, the no-usage absence, and the no-session bare view.
- `packages/dsh-usage/tests/sidebar-panel.spec.tsx`: the collapsed strip (name, tokens, calls, cost), the silent no-usage case, the older-host derivation, the client-side family fold, and the relaxed collapsed polling contract.
- `packages/dsh-usage/tests/apply.spec.ts`: `resolveConfig` without `bubbleMode`.
