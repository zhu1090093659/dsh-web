# Agent Note: npm badge endpoint summing renamed aggregate packages

Status: implemented

## Problem

The root README npm badges pointed at the renamed aggregate @linxin666/dsh-web-all, which has no published version until the next tag release, so shields' native npm badges rendered "package not found or too new". The rename also splits the download history across two package names, and shields cannot sum packages natively. The cumulative family total has the same shape but wider: downloads are spread over every name the family ever published (the retired ones included), over two registries — the npm official registry and the npmmirror registry that serves most domestic traffic — plus this repository's GitHub release assets, none of which shields can sum natively.

## Decision

The dsh-market worker serves three Shields endpoint-badge handlers (market/worker/src/npm-badge.js), registered in the worker fetch router and advertised in openapi.json and api-docs.html:

- GET /api/npm-badge/downloads — last-month npm downloads summed over @linxin666/dsh-web-all and the legacy @linxin666/dsh-web-ui-all, so the badge counts the full history across the rename.
- GET /api/npm-badge/version — the highest latest version across both names (the legacy name leads until the new one ships).
- GET /api/npm-badge/total — all-time cumulative downloads summed over every package name ever published under the family scope (both aggregate names and the retired dsh-live-stats / dsh-client-ui-aionui-panel / dsh-skins names). Ranges are tiled into 365-day windows from the family epoch 2026-01-01 because npm's range API silently clamps to the trailing 18 months and npmmirror rejects wider windows. The summed channels are the npm official registry (api.npmjs.org), the npmmirror registry (registry.npmmirror.com), and this repository's GitHub release assets; binding a fine-grained GITHUB_TOKEN secret (public-repo read-only) moves the GitHub channel to the authenticated quota, and unauthenticated the last good sum keeps serving for up to six hours.

All handlers read their public sources at request time, cache per isolate (one hour for npm data, six for GitHub), answer with cache-control public max-age 1800 for shields and CDN caching, and are CORS-open like the other GET endpoints. The total badge skips a failing channel and shows the remaining sum — only a total absence of data degrades to the grey "unavailable" badge. The root README pair's npm version and cumulative-downloads badges use shields endpoint URLs against these routes. The npm download metric stays the badge's source because it is the ecosystem-comparable convention and the only source covering pre-telemetry history; the Access-gated telemetry dashboard (tv.dsh-market.com) remains an internal ops view, and a future "active installs" badge can be added on the same worker reading the telemetry D1 tables.

## Alternatives considered

- Point both badges at the legacy package until the rename release ships: rejected; it reverses at an unscheduled future date and mislabels the numbers as the new package's own.
- Telemetry-sourced badges now: rejected; telemetry started recording only recently, so it cannot answer cumulative download counts, and the dashboard's Access gating is wrong for a public badge scraper.
- GitHub Action updating a static badge value (gist or committed SVG): rejected; a second moving part when the market worker already serves public JSON.
- Total from the npm official registry only: rejected; it misses the npmmirror installs that carry most domestic traffic and the GitHub release channel — exactly the gap the badge exists to close.

## Consequences

- Badge availability no longer depends on the new package being published; the version badge automatically flips to the new name's version once it exceeds the legacy one.
- npm API outages show as a grey badge instead of a broken image; numbers lag reality by up to one hour.
- Verification: endpoints return cumulative values live (downloads 142.8k/month, version v0.3.2 at ship time) and shields renders both badges with 200; worker deployed as version 05fb80d6-a175-4387-873a-87cd632e21cc.
- Follow-up: after the dual-publish window ends and the legacy name is fully deprecated, the two-name sum can collapse to the single name — the PACKAGES list is the only edit.
- The all-time total stays truthful as data ages: windowed ranges no longer depend on the range API's silent 18-month clamp.
- Retired names carry real traffic through old aggregate dependency pulls, so the total is only meaningful over the complete name list. A cold total compute costs 51 upstream requests today and grows with the family and the windows; if the Workers plan ever caps subrequests below that, precompute the total into D1 from the cron like the users badge.
- Verification: the README pair renders the new cumulative badge; tests cover the three-channel sum, single-channel degradation, the grey path, the token header, and window tiling. Live values sampled 2026-09-02: npm registry 3,539,356 + npmmirror 2,111,236 + GitHub release assets about 2,870 — badge renders 5.7m total.
