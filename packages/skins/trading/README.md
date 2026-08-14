# @linxin666/dsh-client-ui-skin-trading

English | [中文](README.zh.md)

A live-data stock-trading skin (炒股皮肤) for the dsh web GUI — the terminal
look of a trading client, wired to real quotes. It plugs in as a client
plugin: `apply()` sets the `data-dsh-trading` body attribute (the whole
stylesheet's scope), renders the fixed title bar with a candle brand mark and
live quote chips, the scrolling ticker tape (A-shares / HK / US / indices /
crypto / FX, 红涨绿跌), and the market-session status bar (A股 / 港股 / 美股
phases, the HK/US index cells, the workspace count, and the connection
states), pins the document title and injects a candle favicon. Its effect
disposer retracts every write — the attribute, all three bars, the favicon,
and the title unless a session title already replaced it. The stylesheet
ships inside the bundle via CSS-modules auto-inject, so the loader removes it
when the entry is disposed.

## Live data: three tiers, each degrading to the next

1. **dsh-fun-ticker** — when installed, the tape feeds from the user's own
   watchlist through the plugin's same-origin proxy
   (`/plugins/dsh-ticker/api`, host-side Binance / Frankfurter / eastmoney /
   Sina sources): change your fun-ticker 自选 list in its settings page and
   the skin tape follows.
2. **dsh-longbridge** — when installed and configured, the status-bar HK/US
   index cells render the broker snapshot (`/longbridge` loopback RPC
   `panel/snapshot`); the group label reads 长桥.
3. **standalone public feeds** — with no plugin installed, the skin still
   shows live quotes from Tencent `qt.gtimg.cn` (A/HK/US, script-tag loaded),
   Binance 24h tickers (crypto) and Frankfurter ECB rates (FX); the status
   bar falls back to the same sources under the 指数 label. Every fetch path
   fails safe to `--` cells — the chrome never crashes on a dead network.

The skin is presentation-plus-reads: no cordis events are emitted, nothing
reaches a model request. The dark palette
(`body[data-dsh-trading][data-ds-dark-theme]`) is the night-terminal variant
(TradingView-style graphite), the base block the light trading day.

## Installing (official bundle)

Prefer the family aggregate package `@linxin666/dsh-skins` — every skin at
once; for this skin alone, install with `link:`:

```sh
# All skins (recommended)
dsh plugin --profile web add @linxin666/dsh-skins
# Or just this skin
dsh plugin --profile web add @linxin666/dsh-client-ui-skin-trading
# Activate: dsh-skin use trading
# From the repo (dev): dsh plugin --profile web add link:$(pwd)/packages/skins/trading
```

`$(pwd)` is your clone of the dsh-web-ui monorepo.

A local `link:` install needs built artifacts first — `lib/` is git-ignored
and not committed, so run `pnpm install && pnpm -r build` in the monorepo
before linking. Git installs (`dsh plugin --profile web add github:<org>/dsh-web-ui#<sha>`)
build `lib/` themselves via the `prepare` script; pnpm >=10 blocks that until
you copy the printed package key into the profile's `pnpm-workspace.yaml`
`allowBuilds` list and re-run.

Activate or switch with `dsh-skin use trading` (helper script `scripts/dsh-skin`
in the monorepo); only one skin is active at a time. Do not keep two skin rows
active — two skins would both inject window chrome. Remove the row (and its
package) to return to the default look.

## Requirements

- The `dsh-fun-ticker` and `dsh-longbridge` plugins are optional: they upgrade
  the tape and the index cells when present, and their absence is silently
  degraded.
- The live tape talks to public endpoints (qt.gtimg.cn / api.binance.com /
  api.frankfurter.dev) directly from the browser when no plugin is installed;
  a network that blocks these hosts still shows the chrome with `--` cells.
- The workspace-count cell reads the `workspace.list` RPC through the
  `@deepseek-ai/dsh-client-connection` handle when available; without a
  connection it shows `--`.

## Model Experience

None. The skin mutates only the browser DOM and reads quote feeds; nothing
here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known limitations

- The loading page stays stock. The shell's boot page renders before plugin
  bundles exist, so the skin starts at the settled UI.
- Theme switching is skin-internal. The skin pins its own palette under both
  `data-ds-dark-theme` states; switching Appearance themes flips between the
  light and dark terminal palettes, not to a non-skin look.
- Market-session cells model weekdays and hours only; exchange holidays still
  read as an open session.
- US quotes via Tencent report the NYSE/NASDAQ regular session; crypto and FX
  run around the clock, so their cells show live values whenever the network
  allows.
