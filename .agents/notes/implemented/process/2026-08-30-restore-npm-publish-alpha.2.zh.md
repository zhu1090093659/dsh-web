# Agent Note：为 alpha.2 cohort 恢复自动 npm 发布管线

Status: implemented

## Problem

[发布管线暂停](2026-08-28-pause-release-npm-publish-unstable-dsh-alpha.md)的原因，是家族包的 `@deepseek-ai/*` alpha cohort 未发布到 npm，tag 推送会发布出依赖范围无法从 registry 解析的包。这个前提现在不存在了：`@deepseek-ai/*` 0.1.2-alpha.2 cohort 已发布到 npm 的 `alpha` dist-tag（核验 `npm view @deepseek-ai/dsh-client-connection dist-tags` → `alpha: 0.1.2-alpha.2`），仓库 manifest 也已直接按 `^0.1.2-alpha.2` 范围从 `registry.npmjs.org` 解析（tarball store 的 `overrides:` 块与 `scripts/build-cohort-tarballs.mjs` 已在 `build(sdk): resolve the 0.1.2-alpha.2 cohort from npm` 提交里删除）。

## Decision

把 `.github/workflows/release.yml` 里的单一开关 `NPM_PUBLISH_ENABLED` 翻回 `'true'`，并刷新其头部注释。这同时恢复了两个发布步骤——`pnpm -r publish --tag latest` 与 legacy 聚合双发，两者都以 `if: env.NPM_PUBLISH_ENABLED == 'true'` 门控——外加发布后的 strict-registry 冒烟断言，正如 pause note 设计所预期（开关一直是唯一的 remove-me 切换，无需其它改动）。

发布验证用的 DSH 钉点从 `0.1.1-rc.2` 升到 `0.1.2-alpha.2`，位置在 `.github/workflows/release.yml`（verify-release 挂载冒烟）与 `.github/workflows/ci.yml`（plugin-mount 通道）两处。这是必须的：家族包声明 `engines.dsh >= 0.1.2-alpha.1`，而发布门禁会阻断「CI/验证 DSH 版本低于声明下限」的情况（`0.1.1-rc.2` < `0.1.2-alpha.1`）；`0.1.2-alpha.2` 满足下限，并与插件所针对的 cohort 一致。

## Alternatives considered

- 继续暂停管线：拒绝——它防御的前提已解决，用户要求恢复 npm 发布；现在发布会产出可解析的包。
- 只升 `release.yml`：拒绝——挂载冒烟（发布）与每 PR 的 plugin-mount（CI）必须就宿主 cohort 一致，而两者此前都低于下限。

## Consequences

- vX.Y.Z tag 推送现在会把整个家族发布到 npm（`@linxin666`、latest dist-tag），并在挂载检查之后运行 npm-strict 的 registry 冒烟；GitHub Release 不再只是唯一产物。
- `@linxin666/dsh-usage@0.3.7` 与暂停期间的 GitHub-Release-only tag（0.3.7、0.3.8）**不会**补发到 npm；下一个完整发布会把家族升到下一版本并通过管线发布。
- `engines.dsh >= 0.1.2-alpha.1` 下限与根 README 的 DSH 徽章保持原样；它们描述的是声明的最低版本，不是 CI 验证钉点。
