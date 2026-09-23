# Agent Note: Workshop accepts agent-preset contribution PRs

Status: implemented

## Problem

The external-contribution gate (`.github/workflows/reject-non-content-pr.yml`, the PR template, CONTRIBUTING.md, `.github/pr-review-routes.json`) recognized exactly three content-contribution kinds: community-plugin index entries, new skins, and new pets. The Workshop then gained a fourth asset kind — community agent presets, published from `packages/dsh-preset-center/presets/` into the dsh-market.com manifest — but the gate still auto-closed preset PRs from external contributors, and no template section told contributors what a preset submission must contain.

## Decision

- The gate accepts a fourth content kind: agent-preset contributions. A preset PR is recognized by the checked type line 新预设收录（内容贡献，欢迎直接提交，无需先提 issue） in the PR body; `reject-non-content-pr.yml` keeps such PRs open.
- Routing goes through the existing plugins review route: the 插件功能 category line now names 预设中心 among its packages, and the same exact string lives in `.github/pr-review-routes.json` (label + types) so the auto-assigner keeps matching.
- The PR template gains a 新预设收录 checklist derived from the publishing contract in `packages/dsh-preset-center/presets/README.md`: directory-name id rule `^[a-z0-9][a-z0-9-]*$` with the harness-shipped ids reserved, single-line `preset.yml` scalars, composition rules (service rows inside an isolate-realm group, declared `!!js` and local-file loads), a `catalog.json` entry with id/author/version, regenerated `market/dist` plus `market:check`, and local install/enable evidence.
- A preset is code that runs in the DSH host process once enabled, so the template and CONTRIBUTING.md state that review focuses on what the composition actually loads and why, not only what it claims to do.
- CONTRIBUTING.md and ISSUE_TRIAGE.md restate the scope as four accepted content kinds; `scripts/pr-review.test.mjs` keeps its category-line fixture in sync with the template.

## Alternatives considered

- A dedicated 预设 / 预设中心 PR category mirroring the skins route: rejected because preset-center is a plugin package like dsh-pet, whose contributions already ride the plugins category; a new category would add a route entry and a template line without changing who reviews or what is checked.
- Accepting preset PRs with no template changes, relying on reviewer discretion: rejected because the auto-close bot would still reject them, and the security-relevant composition review needs declared evidence, which is what the checklist collects.

## Consequences

- External preset PRs survive the gate when the type line is checked; everything else about the gate (docs rejection, evidence rules, maintainer bypass) is unchanged.
- Preset reviewers get a fixed evidence list; the composition-profile confirmation in the Workshop panel remains the runtime consent boundary.
- The category-line string is duplicated verbatim across the PR template, `.github/pr-review-routes.json`, and `scripts/pr-review.test.mjs`; changing it again requires updating all three because the auto-assigner matches checked lines by exact string.
