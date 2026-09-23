# Agent Note: Usage section renders configured providers only

Status: implemented

## Problem

The overview snapshot enumerates every route the LLM runtime knows (`llm.listProviders()` plus `listConfigurableProviders()`), not only the routes the user actually configured credentials for. Both client cards therefore displayed noise: the usage tab's balance card rendered every catalog provider — unconfigured ones as a name row with an unconfigured-credential muted line — and the plans tab rendered plan-capable routes the user never configured (a name card plus a "no plan data" line). With more catalog routes than configured ones, the two cards were mostly unconfigured placeholder rows, contradicting the plugin's stated "every configured provider" contract.

## Decision

The dsh-usage browser section filters both cards by the credential kind the host already resolves and stamps on every snapshot row: a provider renders in the balance card and on the plans tab only when `credential !== 'none'` (`api-key`, `env`, or an `oauth` grant). An older wire document without the `credential` field renders as before (undefined passes the filter). The balance card's empty state distinguishes "no provider configured" (new `usage.balance.noneConfigured` zh/en/ru key) from "configured providers without a balance endpoint" (`usage.balance.unsupported`), and the aggregated error line ignores unconfigured rows, so a stale persisted error for a since-removed credential no longer renders next to hidden rows. Host enumeration, the wire document, the ledger usage rows, the trend chart, and the pet bubble are unchanged — the filter is display-only in `UsageSectionCard`, refining [the usage statistics plugin](../feature/2026-08-29-usage-statistics-plugin.md).

## Alternatives considered

- **Filtering host-side in `overview()`**: dropping unconfigured routes from the wire document would shrink the payload, but the same array feeds the header's current-provider lookup and the today/trend display-name lookups for ledger rows; a display-only filter keeps the document complete and compatible with older clients.
- **Filtering on probe facts (balance/plan presence)**: showing a row only when a probe fact exists would also hide configured providers whose probes are failing or OAuth-only, dropping the error line and the stale-but-useful fact the service deliberately retains. `credential` is the stable "did the user configure this" signal.

## Consequences

- On a fresh host boot, before the first probe cycle, every route reports `credential: 'none'`, so both cards briefly show the none-configured empty state until the first poll completes; persisted snapshots warm this within one cycle.
- The `usage.balance.noCredential` copy stays in the dictionaries as the defensive render for legacy fallback paths but no longer appears through the filtered cards.
- `tests/section-card.spec.tsx` pins the behavior: configured rows render, unconfigured balance/plan/error rows do not, and the two empty states are distinct.
