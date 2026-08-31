# Agent Note: Usage statistics plugin (dsh-usage)

Status: implemented

## Problem

DSH routes model calls through pluggable pi-ai providers (kimi-coding, zai-coding-cn, opencode-go, deepseek, ...), each with its own credential and its own billing model — pay-as-you-go balance or a coding-plan quota with rolling windows. Nothing in the family showed any of that: the removed dsh-live-stats estimated tokens client-side but never per-provider, and a third-party community plugin (dsh-provider-usage) covers DeepSeek-centric balances only. The user asked for a first-party plugin that (a) detects balance/plan usage for every configured provider, (b) keeps a live token usage ledger, (c) lives as a first-level settings section below the Workshop entry, and (d) feeds the current provider's status to the pet as a dedicated bubble.

## Decision

`packages/dsh-usage` (`@linxin666/dsh-usage`) ships host-led and browser-thin:

- **Host service** (`src/host/usage-service.ts`): folds `session/event` into a persistent per-day/per-provider/per-model ledger at `$DSH_HOME/dsh-usage/usage-ledger.json` (route attribution from `request/header`/`request/context`, exact `TokenUsage` buckets from `assistant/message`; constructor-seed events never re-emit, so a live fold cannot double-count). On a settings-driven poll cycle it enumerates routes via `ctx.llm.listProviders()/listConfigurableProviders()`, resolves credentials through the seam (`llm-pi-ai` records, then the profile `apiKeyEnv` reference, then DeepSeek's `DEEPSEEK_API_KEY`), and probes each provider from `src/core/adapters.ts` — normalized into `balance`/`plan` views. OAuth grants are typed, never spent. Snapshots persist beside the ledger so a failed probe degrades to stale-data-plus-error-line.
- **Browser half**: a first-level `settings.section` with `id: dsh-usage`, `order: 151` (directly below the Workshop's 150), two tabs — 用量 (today totals, per-provider rows, balances, 30-day trend) and 个人套餐 (per-provider quota windows with percent + reset) — plus a compact settings row. The overview comes from loopback-fenced `GET/POST /api/dsh-usage/overview|refresh`; keys never reach the browser. Polling runs only while the section is open.
- **Pet linkage**: after each poll the host announces the current provider (last live route this boot, else the `agent-default-model` selection) to `ctx.pet.announce(...)` — see [the pet announcement contract](2026-08-29-pet-announcement-bubble.md).

Endpoint coverage (verified 2026-08): DeepSeek and Moonshot balance, Kimi For Coding `usages`, GLM Coding Plan `quota/limit` (raw key, no Bearer; `unit` 3=5h, 6=week), OpenCode Go `zen/go/v1/usage`, MiniMax coding-plan `remains` (remaining-percent semantics), OpenRouter credits, SiliconFlow `user/info`, ZenMux management balance. Qwen token plans, OpenCode Zen PAYG, Anthropic, and OpenAI expose no key-usable endpoint and list without facts.

## Alternatives considered

- **Browser-side probing**: several balance hosts send CORS headers, and skipping the hop would make refresh instant. Lost: Kimi, OpenCode, and ZenMux block CORS outright, and browser fetch would expose every API key to the page — the host-side probe keeps secrets server-side for all providers uniformly.
- **Backfilling history via session projections**: the projection registry replays stored logs, so old sessions could populate the ledger. Lost for v1: the ledger keys on local day + route, while historical logs attribute no route until a `request/header` arrives mid-log, and seeding a projection registry key for a cross-session aggregate misfits the per-session projection contract. Counting starts at enable; revisit if backfill is actually missed.
- **A whale-widget-style floating widget** (after MeteorNOX/DeepSeek-Balance-Whale-Widget): self-drawn overlay with its own loopback port. Lost: the user asked for settings-page placement plus pet linkage; the pet announcement bubble replaces the widget's mascot surface, and the section reuses the family's settings/slot machinery instead of a second HTTP listener.

## Consequences

- Usage counting starts when the plugin is first enabled; historical sessions are not backfilled (documented in the README).
- Adapter parses codify third-party response shapes (two of them officially undocumented: GLM's `unit` discriminator, MiniMax's remaining-percent fields); a provider reshaping its payload degrades that provider to an error line until the adapter is updated.
- The pet bubble silently no-ops when dsh-pet is absent — the section works unchanged.
