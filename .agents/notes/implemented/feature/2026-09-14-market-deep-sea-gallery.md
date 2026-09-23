# Agent Note: Deep-sea gallery redesign for the dsh-market.com site

Status: implemented

## Problem

The dsh-market.com creative-workshop home page presented the catalog as an internal index: a header, a per-tab awards podium, and a dense card grid. The owner approved a new visual direction, the deep-sea gallery prototype, that turns the home page into an editorial entry point: a hero statement, a popularity showcase, and a discovery grid with personal favorites. The production site had to adopt that design without giving up the behavior it already had: live manifests, vote and install counters, Turnstile-gated likes, per-kind detail media and install instructions, skin try-on links, and anonymous pageview telemetry.

## Decision

`market/src/index.html` and `market/src/app.js` implement the deep-sea gallery layout while keeping the production data layer intact.

- Backdrop: a fixed WebGL fluid-wave canvas under a screen-blended whale-tail overlay; the whale image is the site-owned asset `market/src/assets/ocean-whale.webp`.
- Header: brand "DSH Market / 创意工坊"; nav tabs 编辑推荐 / 探索 / 皮肤 / 宠物 / 插件 / 预设 with 探索 (the new `all` kind) as the default; search; GitHub star link.
- Hero and showcase: the serif headline 让工具，长成你喜欢的样子。 and a three-card popularity showcase (one main plus two side cards) shown only on 探索. The showcase ranks skins by votes, then by catalog rank.
- Discovery list: the 发现更多 section carries the result count, a sort select (按人气 / 按安装量 / 按默认 / 名称排序), the 我的收藏 filter, a chip row, a four-column card grid, and a load-more control.
- Filters: plugins and presets keep the two-level category plus subcategory chips; skins and pets, and any search or favorites view, show curated tag chips. 编辑推荐 (added later, see [the editor-picks note](2026-09-16-workshop-editor-picks.md)) shows no chip row, keeps its fixed manifest order and disables the sort select.
- Favorites: 我的收藏 persists a device-local `kind:id` list in `localStorage` (`dsh-market-saved`) and is toggled from the detail dialog; favorites never reach the server.
- Cards: skins show their light preview, pets their first preview contained inside a fixed-ratio media box, and plugins and presets a text card (icon, category, description). Skin, plugin, and preset names still link to `item.repo`.
- Detail dialog: per-kind media and install instructions are unchanged (skin light and dark preview plus 实时试穿, pet previews and spritesheet, plugin npm command with copy, preset install steps), now ending with a like button and a 收藏作品 action.
- Motion: a footer 背景动效 toggle flips `window.marketWave.setEnabled(...)` and the `.ocean.paused` class; it is forced off under `prefers-reduced-motion: reduce`.
- Deep link: `#kind:id` opens the matching detail dialog on load and is cleared on close.
- The per-tab awards podium is removed.

## Build and asset pipeline

`scripts/market-build` now also mirrors `market/src/assets/**` into `market/dist/assets/**`, so the site references the whale artwork like any other static asset. The regenerated `market/dist` (including `manifest/*.json` with their `generated` date) is committed.

## Markup contracts preserved

The market layout regression tests pin four site contracts and the redesign keeps them: the `data-kind="preset"` tab in the HTML, `el('a', 'mk-card-name')` plus `name.href = item.repo` for repo-backed card names, `media.classList.add('mk-card-media-pet')` for pet media, and the pet contain rule `max-height: calc(100% - 16px);`.

## Alternatives considered

- Ship the standalone prototype bundle (its `dist/index.html`, `data.js`, `waves.js`, synthetic likes and installs, simulated install): rejected because it would replace real API-backed votes, install counters, and install instructions with mock data and a demo install flow.
- Keep the podium layout and only retune its palette: rejected because the approved direction changes the information architecture (hero, popularity showcase, discovery grid, favorites), not just colors.
- Bundle the prototype subset fonts (`DSH Editorial`, `DSH Chinese`, `DSH Sans`): rejected; the system `Songti SC` and `Noto Serif SC` fallbacks carry the editorial look without adding roughly 650 KB of binary assets and another font license.
- Adopt the prototype 最新发布 sort: rejected; the production manifests carry no publish date, so the select offers 按人气 / 按安装量 / 按默认 / 名称排序 instead.

## Consequences

- The home page opens on 探索, which aggregates all four catalogs (134 items at this revision); the other tabs still scope to one kind.
- Favorites are local to the browser and do not affect install or vote statistics.
- The whale artwork adds one roughly 41 KB binary asset to `market/dist`; the committed dist stays reproducible through `node scripts/market-build --check`.
- Sorting by install count uses the `/api/stats` install counters and degrades to vote and rank order when the API is unavailable (a static preview server shows the offline notice).
- `docs/screenshots/31-market-home.png`, referenced by both READMEs, is refreshed to the new home page.

## Testing

- `node scripts/market-build` then `node scripts/market-build --check` reports the committed dist up to date.
- `node --test scripts/market-layout.test.mjs scripts/market-build-clean.test.mjs` passes (12 tests), including the clean-checkout `--check` fixture.
- The rendered site was exercised in Chrome through Playwright at 1512x950 and 390x844: the 探索 landing, the skin, pet, and plugin tabs, the plugin category and subcategory chips, the detail dialog with light and dark preview, the favorites toggle and 我的收藏 filter, and the mobile layout; no unexpected console errors.
