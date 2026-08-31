# Agent Note: Root README DSH compatibility badge

Status: implemented

## Problem

The root README badge row presented the ecosystem's own metrics (release, stars, forks, npm, users, license) but never stated which DeepSeek Harness (DSH) release the plugin family is compatible with. Users had to read package metadata (the `dsh.engines.dsh` floor on the aggregate package) or release notes to learn whether current dsh-web works with their DSH, while ecosystem topics elsewhere already show per-plugin DSH version badges.

## Decision

The root README pair (README.md, README.en.md) carries one more badge in the same centered row: a static shields.io badge reading `DSH | 0.1.2-alpha.1` (slate label segment, indigo value segment, flat-square) linking to the npm package `@deepseek-ai/dsh`, placed between the users badge and the license badge. The displayed value is the newest DSH release the current SDK cohort is verified against; it equals the cohort pinned across pnpm-workspace.yaml, shared/package.json, and every package's devDependencies — and since the 0.1.2-alpha.1 source-built preview it can sit ahead of the npm registry, whose `@deepseek-ai/dsh` latest remains 0.1.1-rc.2 until the cohort publishes. The version is bumped by hand inside the SDK-cohort upgrade flow, which already revalidates the whole family against the target release. The badge is presentation, not a machine-checked contract: `dsh.engines.dsh` in packages/dsh-web-all/package.json stays the machine-readable compatibility floor.

## Alternatives considered

- A dynamic endpoint on the dsh-market worker reading `dsh.engines.dsh` from the published npm tarball: rejected; it adds a worker route, tests, deployment, and tarball parsing to display a value that only changes when the SDK cohort changes, and the npm badge endpoint note already rejected extra moving parts where a public static value suffices. If the manual bump ever proves unreliable, an endpoint can supersede this decision on the same worker.
- A live "supported vs latest DSH" comparison badge (green while the latest release falls inside the supported range, red otherwise): rejected; the stronger signal buys a continuous correctness risk — every upstream DSH release that lands before dsh-web's tested upgrade would flip the badge red without any repo change, and it needs the same endpoint infrastructure.
- A shields static badge updated by a GitHub Action or gist: rejected for the same reason as in the npm badge endpoint note — a second moving part that a plain static URL avoids entirely.

## Consequences

- The badge row states DSH compatibility at a glance in both languages; the value trails a cohort upgrade by exactly one manual edit, and the README pair is edited together per the i18n contract.
- If a DSH release ships before the upgrade flow runs, the badge understates compatibility (it shows the older verified version) instead of claiming untested support; no red state exists by design.
- Verification: shields returns the badge with HTTP 200 rendering label DSH and value 0.1.2--alpha.1 (re-verified 2026-08-29 with the cohort bump); the npm registry's latest `@deepseek-ai/dsh` remains 0.1.1-rc.2 until the preview cohort publishes.
- Related: [npm badge endpoint](../feature/2026-08-24-npm-badge-endpoint.md) (badge infrastructure precedent and its no-extra-moving-parts rationale), [banner social refresh](2026-08-24-banner-social-refresh.md) (badge-row ownership in the root README).
