# dsh-web 0.3.3 发布准备

## 范围

本版本统一发布 `packages/` 与 `packages/skins/` 下由 `scripts/lib/family-packages.mjs` 发现的 20 个公开家族包；根 package.json 与 shared 私有包不发布。所有家族包版本为 0.3.3，皮肤中心只随包分发 blue-fantasy，其余皮肤由 Workshop 按需安装。

| 目录 | npm 包 | 版本 | 发布状态 |
| --- | --- | --- | --- |
| packages/dsh-community-plugins | @linxin666/dsh-client-ui-community-plugins | 0.3.3 | public |
| packages/dsh-desktop-launcher | @linxin666/dsh-desktop-launcher | 0.3.3 | public |
| packages/dsh-doctor | @linxin666/dsh-doctor | 0.3.3 | public |
| packages/dsh-git-graph | @linxin666/dsh-client-ui-git-graph | 0.3.3 | public |
| packages/dsh-i18n | @linxin666/dsh-i18n | 0.1.0 | public |
| packages/dsh-liangshen | @linxin666/dsh-liangshen | 0.3.3 | public |
| packages/dsh-market | @linxin666/dsh-client-ui-market | 0.3.3 | public |
| packages/dsh-pet | @linxin666/dsh-pet | 0.3.3 | public |
| packages/dsh-plugin-manager | @linxin666/dsh-client-ui-plugin-manager | 0.3.3 | public |
| packages/dsh-remote-web-ui | @linxin666/dsh-remote-web-ui | 0.3.3 | public |
| packages/dsh-session-id | @linxin666/dsh-client-ui-session-id | 0.3.3 | public |
| packages/dsh-skill-explorer | @linxin666/dsh-client-ui-skill-explorer | 0.3.3 | public |
| packages/dsh-ssh | @linxin666/dsh-ssh | 0.3.3 | public |
| packages/dsh-task-board | @linxin666/dsh-client-ui-task-board | 0.3.3 | public |
| packages/dsh-tool-describe-image | @linxin666/dsh-tool-describe-image | 0.3.3 | public |
| packages/dsh-usage | @linxin666/dsh-usage | 0.3.3 | public |
| packages/dsh-web-all | @linxin666/dsh-web-all | 0.3.3 | public |
| packages/dsh-web-settings | @linxin666/dsh-client-ui-web-ui-settings | 0.3.3 | public |
| packages/skins/skin-center | @linxin666/dsh-client-ui-skin-center | 0.3.3 | public |

## Registry transition

- `@linxin666/dsh-web-all@0.3.3` is the first release under the renamed aggregate identity and must be published before the legacy package.
- `@linxin666/dsh-web-ui-all@0.3.2` is the previous release; `0.3.3` is unoccupied and is the first dual-published legacy transition version.
- `scripts/publish-legacy-aggregate.mjs` limits the legacy transition to two versions and writes `dsh.migrate.to` / `dsh.migrate.since` into the legacy tarball.
- After the second transition version, deprecate `@linxin666/dsh-web-ui-all` with the migration instruction instead of publishing another version.
- External aggregate dependency `dsh-better-sidebar@0.18.0-alpha.0` is registry-readable (the alpha.2-aligned build that brought better-sidebar back after its 2026-08-30 exclusion; its pnpm `minimumReleaseAgeExclude` pin stays required while the version is recent). `@mlgbnb/dsh-archive-manager@1.0.7` remains excluded from the 0.1.2-alpha.2 family bundle (its build still imports the removed `@deepseek-ai/dsh-client-runtime` face); re-add it to the aggregate when upstream ships a compatible build.

## Compatibility boundary

All `web-ui-*` bundle ids, `dsh-web-ui-market`, `/api/dsh-web-ui-settings`, and the `dsh-web-ui-settings-proxy-token` header remain frozen. Doctor migration and plugin-manager migration use the shared legacy mapping; Doctor invokes Windows `.cmd` shims through constrained `cmd.exe` arguments. Direct `dsh web` bypasses Doctor migration. Skin Center preserves the provenance-only path for current Workshop installs and additionally restores pre-provenance hook effects only when the installed manifest and hook bytes match the generated reviewed identity; `pnpm skin-center:check` rejects identity-registry drift.

This release has fresh-install, unit migration, and Linux CI mount evidence. It does not claim real previous-version upgrade drills, failure-injection drills against published tarballs, or a macOS / Windows upgrade matrix. Manual recovery is documented in `docs/release-notes/v0.3.3.md`.

## Required gates

```sh
pnpm sync-shared:check
pnpm typecheck
pnpm test
pnpm test:scripts
pnpm aggregate:check
pnpm runtime-deps:check
pnpm docs:check
pnpm skin-center:check
pnpm community:check
pnpm market:check
pnpm build
node scripts/verify-version.mjs 0.3.3
```

The CI and release smoke lanes mount into `@deepseek-ai/dsh@0.1.2-alpha.4`, the same host version the family requires through `dsh.engines.dsh >=0.1.2-alpha.4`.
