# dsh-usage · Token Usage Breakdown, API Balance & Cost Monitor for DeepSeek Harness (DSH)

English | [中文](README.zh.md)

<p align="center">
  <img src="https://img.shields.io/npm/v/@linxin666/dsh-usage?style=flat-square" alt="Version">
  &nbsp;
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.2--rc.1-4c6ef5?style=flat-square&amp;labelColor=454a54" alt="DSH">
  &nbsp;
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>Token Usage Breakdown, Multi-Provider Balance & Cost Monitor for DeepSeek Harness (DSH)</strong><br>
  <em>Daily Token Analytics · Provider API Balance · Subscription Quotas · Peak/Off-Peak Costing · Token Bank</em>
</p>

A dedicated token usage and cost monitoring plugin for DeepSeek Harness (DSH) Web GUI and official desktop client: multi-provider balances, coding subscription quota tracking, live token accounting ledgers, and a compact quick-glance card above settings in the sidebar.

## What it does

The plugin runs a host-side service and a Usage page under Settings → Web Extensions (or a standalone first-level 使用统计 section when that parent is absent):

- **Usage tab (用量)**: today's token totals per bucket (input / output / cache read / cache write, disjoint as the provider reports them) with per-provider and per-model breakdown, the last 30 days as a horizontal provider/model bar chart, and the balance of every configured provider (one row per adapter family: a dormant catalog alias shadowed by the family's live route no longer renders its own balance row). A **day picker** switches that card to any retained day that recorded usage (today first, then the other days newest first) and the card then shows that day's own totals, provider rows, and estimated spend; the peak/off-peak line stays on today because it describes the pricing window now. The ledger folds live `session/event` streams (`request/header` route attribution plus `assistant/message` usage) into `$DSH_HOME/dsh-usage/usage-ledger.json` with day-based retention, so past days survive restarts; counting starts when the plugin is first enabled. For the official DeepSeek family the tab also shows the current peak/off-peak pricing period (Beijing weekdays 09:00-12:00 and 14:00-18:00 are peak, billed at double) and today's estimated spend in CNY; that line is toned by the current clock — red while peak, green while off-peak — and always carries the word plus a dot, so colour is never the only signal.
- **Plans tab (个人套餐)**: coding-plan quota windows for every configured provider that exposes one — used percent and reset time per window (Kimi For Coding 5h/week, GLM Coding Plan 5h/week/month, OpenCode Go rolling/weekly/monthly, MiniMax 5h/week, Codex / ChatGPT subscription 5h/week). Providers without a real plan or subscription (DeepSeek, ZenMux, Moonshot, OpenRouter, SiliconFlow) never appear on this tab; their balance shows on the usage tab instead.
- **Token Bank tab (Token 银行)**: the whale-yuan voucher (鲸元券) minted from every provider's ledger usage at an anti-inflation exchange rate of 1,000,000 tokens per whale yuan: the DeepSeek official family (the `deepseek` catalog alias, the live `deepseek-official` route and the signed-in `deepseek-account` route) counts its tokens and calls beside every subscription and relay route. The tab sums those retained-ledger totals, stamps the minted face value onto the banknote artwork with a serial line carrying the minting window, and offers a save-image button plus a native share button when the browser supports sharing files. The spend line stays official-family only: it shows the real CNY total observed from the official balance once available — balance decreases accrue as spend, top-ups never count — and falls back to the fold-time estimate before the first observation, because subscription and relay routes ship no price book. The minted total prefers the host's whole-ledger aggregate and falls back to the last 30 days on an older host; with no usage at all the tab shows its empty state. A day picker mints the note from one picked day instead of the whole retention window (the observed-spend line, which accrues from the first balance reading, is whole-window only and falls back to that day's fold-time estimate on a single day). The on-note text is locale-neutral (digits, latin captions, ISO dates) and the export is rendered locally in the browser.
- **Sidebar foot card**: a compact glance seated above the sidebar's Settings row — today's estimated spend as the headline (today's tokens when nothing priced is recorded yet), the tokens/calls line, and up to two configured-provider balances with a +N overflow. The whole card is one button that opens the usage settings section, so detail stays in one place, and the corner chevron folds it into a one-line strip (the spending provider's name, the peak marker, the label, and the headline value), a choice persisted across reloads. When today's spend runs on the official DeepSeek route the card marks the pricing clock for the current date and hour (weekends and Chinese public holidays are off-peak for the whole day, so the red state only ever appears inside a weekday peak window): a red dot with 高峰 (peak) or a green dot with 空闲 (off-peak), plus a line naming when the current period ends or when peak returns in the expanded state; a card for any other provider never carries the marker. It polls at a relaxed 30 s cadence while the tab is visible, hides in the collapsed 56 px rail, and disappears while the plugin is disabled.
- Probes run entirely host-side on a poll cycle (default 60 s, manual refresh button); API keys are resolved through the harness credential seam (`llm-pi-ai` records, `apiKeyEnv` references) and never reach the browser.

Supported balance endpoints: DeepSeek (the official live route `deepseek-official` and the catalog alias `deepseek` both resolve), Moonshot (CN/international), OpenRouter, SiliconFlow (CN/international), ZenMux. Supported plan endpoints: Kimi For Coding, GLM Coding Plan (CN via open.bigmodel.cn, international via api.z.ai — the `zai` route the pi-ai catalog registers, plus the `zai-coding` / `zai-coding-cn` aliases; 5-hour, weekly and monthly windows, token-metered and credit-metered plans), OpenCode Go, MiniMax, Codex / ChatGPT subscription (OAuth access token from the pi-ai grant; a stale token shows an error until the harness next refreshes it). Providers without a programmatic endpoint (Qwen token plans, OpenCode Zen PAYG, Anthropic, OpenAI) are listed without facts.

### Spend estimate scope

Today's spend is an estimate priced at fold time from the published DeepSeek peak/off-peak price book (CNY per million tokens; peak = the windows above, off-peak half of peak). The rows in force are `deepseek-flash` (DeepSeek-V4.1-Flash) and `deepseek-v4-pro`: the retired flash ids (`deepseek-v4-flash`, `deepseek-v4-flash-vision-exp`) bill the flash row, and `deepseek-v4-pro` moves to that row once DeepSeek routes the id to V4.1-Flash on 2026-09-14 12:00 Beijing.

It covers the official DeepSeek routes only — relay traffic billed elsewhere (ZenMux, SiliconFlow, ...) stays unpriced — and unknown DeepSeek model ids take the flash-class row. Buckets recorded before a price change keep the old pricing, so a price-book update is reflected from the moment it ships, not retroactively.

The published rule bills a Chinese public holiday entirely off-peak even on a Monday-Friday, and bills an adjusted workday falling on a Saturday or Sunday off-peak too. Weekends are therefore already off-peak by construction, and this package ships the State Council holiday table (`src/core/holidays.ts`, 2020 through 2026, taken from the MIT-licensed [chinese-holidays-node](https://github.com/bastengao/chinese-holidays-node) yearly data with only its `holiday` entries), so a public-holiday weekday is estimated at the off-peak row instead of reading up to about twice the real spend. A year the table does not cover (later than 2026) falls back to the published windows, which reads high rather than low — the safer direction to be wrong in.

## Install

Requires DSH 0.2.2-rc.1 or later: the plugin is developed against the 0.2.2-rc.1 DSH cohort (its settings page is the Host-generated page of the plugin's own Config schema) and its `@deepseek-ai/*` runtime imports are provided by the host itself.

In your profile (e.g. `~/.dsh/profiles/web`):

```bash
pnpm add @linxin666/dsh-usage
```

and insert into `cordis.patch.yml` (or use the bundle patch):

```yaml
- insert:
    - id: usage
      name: '@linxin666/dsh-usage'
```

Restart `dsh web` for the host half; the client half applies on refresh. A full family install opens `Settings -> Web Extensions -> Usage`; a standalone install keeps `Settings -> Usage Statistics`.

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch; off = no listeners, no probes, no routes |
| `pollIntervalSec` | `60` | Provider probe cycle (30-3600 s; a change reloads the plugin row) |
| `retainDays` | `180` | Ledger retention in local days (7-730) |

## Known limitations

- Usage counting starts when the plugin is first enabled; historical sessions are not backfilled.
- OAuth-based routes (for example qwen OAuth grants) are detected as such but not probed; the plugin does not spend third-party OAuth budgets.
- A failed probe keeps the previous fact visible and reports the error line; providers may rate-limit aggressive polling.
- The voucher's face value covers the ledger's retention window (`retainDays`): pruned days drop out of both the trend chart and the note.
- The day pickers list only days the ledger recorded usage on: a day without usage is never offered, and a day pruned by retention leaves an empty or zeroed card rather than a different one.
- The real-spend watch starts at the first official balance observation: earlier consumption is not backfilled, and only observed balance decreases accrue (a balance rise is a top-up and never counts).
