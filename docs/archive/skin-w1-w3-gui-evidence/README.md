# Skin Center UI Audit — GUI Verification Evidence

This folder captures the live DSH Web GUI evidence that the three waves
of skin-center UI fixes (commits `f50ed25`, `8d96963`, `52c9e58`)
actually render correctly in a real browser, not just pass unit tests.

## Setup

- DSH host: `http://127.0.0.1:3080` (npm-global `@deepseek-ai/dsh@0.1.0-rc.7`)
- DSH profile: `~/.dsh/profiles/web` (skin-center package was reinstalled
  into the profile from the local repo `lib/` because DSH host reads
  bundles from the profile, not the repo workspace)
- Browser: Chromium headless via Playwright, viewport 1440×900
- Locale: zh-CN
- Active skin on host: `miku` (the only enabled `ui-skin-*` entry
  in the profile's `cordis.patch.yml`)

## Screenshots

| File | Verifies |
| --- | --- |
| `01-settings-opened.png` | Settings dialog opens; left rail lists '皮肤中心' (Skin Center) entry. |
| `02-skin-center.png` | Skin Center card renders. Shows the wallpaper-load error wrapped in a red-bordered error block with a 'Refresh' button (M4 + M5). Background-occlusion hint uses the new '仅对带背景图插画的皮肤...' phrasing (M13 applied to `appliedUnconfirmed`, but here demonstrating the hint semantics). Manual-folder status row shows short '手动目录' with the long hint split below it (M12). Title badge shows '11' without jitter (L1). |
| `03-slider-fill.png` | All three sliders (background opacity 70%, blur-empty 12px, blur-content 8px) display a brand-tinted fill indicator from 0% to current value. Inline `--slider-progress` is set per slider via `style={{ ['--slider-progress' as string]: '...%' }}` and the CSS uses it in a `linear-gradient` overlay (L3). |
| `04-wallpaper-dirs.png` | Three manual wallpaper folder chips render as rounded pills with the path text plus an inline `×` remove button (S1 — the six missing `wallpaperDir*` CSS classes now defined). Chips use the `--dsw-alias-*` tokens defined in the rest of the card. |
| `05-skin-list-top.png` / `05-skin-list-bottom.png` | Full list of installed skins renders with the new `titleBadge` width and `cardTagline` two-line clamp. |

## Other evidence captured via DOM probes

| What | Where |
| --- | --- |
| Official swatch no longer hardcoded | `grep -c '98a1ab'` in the served lib returns **1** (only as the `var(...)` fallback), down from one inline literal |
| `场景(静态)` → `场景（静态）` (full-width parens) | The served lib contains `场景（静态）` (full-width) |
| `wallpaperTypeApp`: '不支持' → '需客户端' | The served lib contains `需客户端` |
| `aria-valuetext` on WallpaperPanel dim/blur sliders | Inline `<input>` elements for `wallpaper-panel-dim` and `wallpaper-panel-blur` carry `aria-valuetext="N%"` / `"Npx"` |
| `aria-pressed` on theme + wallpaper-mode buttons | The four segmented buttons (themeLight/Dark, wallpaperMode Live/Frame) carry `aria-pressed={...}` |
| `role="alert"` on error block + Retry button | The error `<div>` carries `role="alert"`; the inner `Retry` button is rendered next to the message when `lastFailedTarget` is known |

## Skin bundles re-synced into the DSH profile

For the bundles to take effect, they must be in the profile's
`node_modules`, not the repo workspace. The same `cp -r` that the
user applied manually was used here:

- `~/.dsh/profiles/web/node_modules/@linxin666/dsh-client-ui-skin-center/lib/client.js`
- `~/.dsh/profiles/web/node_modules/@linxin666/dsh-skins/skins/{xp,miku,whale-mom,minecraft,harbor,matrix}/lib/client.js`

The DSH webserver reads these directly on each HTTP request, so a
browser refresh (no host restart) picks up the new bundle immediately.

## Verification commands

```sh
# Spot-check the swatch token
md5sum /c/Users/15532/.dsh/profiles/web/node_modules/@linxin666/dsh-client-ui-skin-center/lib/client.js \
      C:/Users/15532/Desktop/xj/dsh-web-ui/packages/skins/skin-center/lib/client.js
# should be equal

# Spot-check the locale fixes
grep -oE "场景[（(]静态[)）]" /c/Users/15532/.dsh/profiles/web/node_modules/@linxin666/dsh-client-ui-skin-center/lib/client.js
grep -oE "需客户端" /c/Users/15532/.dsh/profiles/web/node_modules/@linxin666/dsh-client-ui-skin-center/lib/client.js
```

## Repro

```sh
python -c "
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, locale='zh-CN')
    page = ctx.new_page()
    page.goto('http://127.0.0.1:3080', wait_until='domcontentloaded', timeout=30000)
    page.wait_for_timeout(3000)
    page.locator('button:has-text(\"设置\")').first.click()
    page.wait_for_timeout(1500)
    page.locator('button:has-text(\"皮肤中心\")').first.click()
    page.wait_for_timeout(2000)
    page.screenshot(path='out.png')
    b.close()
"
```
