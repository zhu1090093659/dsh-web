# dsh-usage

English | [中文](README.zh.md)

Usage statistics plugin for the dsh web GUI: per-provider balance and coding-plan quota detection plus a live token usage ledger.

## What it does

The plugin runs a host-side service and a first-level settings section (使用统计, directly below the Workshop entry):

- **Usage tab (用量)**: today's token totals per bucket (input / output / cache read / cache write, disjoint as the provider reports them) with per-provider and per-model breakdown, the last 30 days as a horizontal provider/model bar chart, and the balance of every configured provider (one row per adapter family: a dormant catalog alias shadowed by the family's live route no longer renders its own balance row). For the official DeepSeek family the tab also shows the current peak/off-peak pricing period (Beijing weekdays 09:00-12:00 and 14:00-18:00 are peak, billed at double) and today's estimated spend in CNY. The ledger folds live `session/event` streams (`request/header` route attribution plus `assistant/message` usage) into `$DSH_HOME/dsh-usage/usage-ledger.json` with day-based retention; counting starts when the plugin is first enabled.
- **Plans tab (个人套餐)**: coding-plan quota windows for every configured provider that exposes one — used percent and reset time per window (Kimi For Coding 5h/week, GLM Coding Plan 5h/week/month, OpenCode Go rolling/weekly/monthly, MiniMax 5h/week, Codex / ChatGPT subscription 5h/week). Providers without a real plan or subscription (DeepSeek, ZenMux, Moonshot, OpenRouter, SiliconFlow) never appear on this tab; their balance shows on the usage tab instead.
- **Token Bank tab (Token 银行)**: the whale-yuan voucher (鲸元券) minted from the official DeepSeek family's ledger at an anti-inflation exchange rate of 1,000,000 tokens per whale yuan. The tab sums the family's retained-ledger tokens (the `deepseek` catalog alias and the live `deepseek-official` route combined), stamps the minted face value onto the banknote artwork with a serial line carrying the minting window, and offers a save-image button plus a native share button when the browser supports sharing files. The spend line shows the real CNY total observed from the official balance once available — balance decreases accrue as spend, top-ups never count — and falls back to the fold-time estimate before the first observation. The minted total prefers the host's whole-ledger aggregate and falls back to the last 30 days on an older host; with no official DeepSeek usage the tab shows its empty state. The on-note text is locale-neutral (digits, latin captions, ISO dates) and the export is rendered locally in the browser.
- Probes run entirely host-side on a poll cycle (default 60 s, manual refresh button); API keys are resolved through the harness credential seam (`llm-pi-ai` records, `apiKeyEnv` references) and never reach the browser.

Supported balance endpoints: DeepSeek (the official live route `deepseek-official` and the catalog alias `deepseek` both resolve), Moonshot (CN/international), OpenRouter, SiliconFlow (CN/international), ZenMux. Supported plan endpoints: Kimi For Coding, GLM Coding Plan (CN via open.bigmodel.cn, international via api.z.ai — the `zai` route the pi-ai catalog registers, plus the `zai-coding` / `zai-coding-cn` aliases; 5-hour, weekly and monthly windows, token-metered and credit-metered plans), OpenCode Go, MiniMax, Codex / ChatGPT subscription (OAuth access token from the pi-ai grant; a stale token shows an error until the harness next refreshes it). Providers without a programmatic endpoint (Qwen token plans, OpenCode Zen PAYG, Anthropic, OpenAI) are listed without facts.

### Spend estimate scope

Today's spend is an estimate priced at fold time from the published DeepSeek peak/off-peak price book (CNY per million tokens; peak = the windows above, off-peak half of peak). The rows in force are `deepseek-flash` (DeepSeek-V4.1-Flash) and `deepseek-v4-pro`: the retired flash ids (`deepseek-v4-flash`, `deepseek-v4-flash-vision-exp`) bill the flash row, and `deepseek-v4-pro` moves to that row once DeepSeek routes the id to V4.1-Flash on 2026-09-14 12:00 Beijing.

It covers the official DeepSeek routes only — relay traffic billed elsewhere (ZenMux, SiliconFlow, ...) stays unpriced — and unknown DeepSeek model ids take the flash-class row. Buckets recorded before a price change keep the old pricing, so a price-book update is reflected from the moment it ships, not retroactively.

## Install

Requires DSH 0.1.7-alpha.1 or later: the plugin is developed against the 0.1.7-alpha.1 DSH cohort (its settings page is the Host-generated page of the plugin's own Config schema) and its `@deepseek-ai/*` runtime imports are provided by the host itself.

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

Restart `dsh web` for the host half; the client half applies on refresh. The section lives in `Settings -> Usage Statistics`.

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
- The real-spend watch starts at the first official balance observation: earlier consumption is not backfilled, and only observed balance decreases accrue (a balance rise is a top-up and never counts).
