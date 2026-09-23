# Agent Note: PR 维护轮 2026-09-11 — 合入两个皮肤 PR，退回一个插件登记

Status: implemented

## Problem

默认维护范围是 `zhu1090093659/dsh-web` 中 assignees 含维护者账号的全部开放 PR。本轮命中六个：三个等待首次评审（#1464 暗夜鎏金皮肤、#1468 blue-fantasy 文字可读性层、#1467 dsh-thread-tools 社区登记），以及三个自此前 changes-requested 评审后仍卡在作者一侧的登记（#1399 provider-signin、#1321 dsh-memory、#1318 dsh-git-badge）。工作规则要求第三方插件登记完成实用性 / 稳定性 / 兼容性三项证据分析，只从验证过的干净状态合并，并把本账号已评审过的 PR 视为等作者回应。

## Decision

#1464 与 #1468 完成评审、批准并以 merge 提交合入 `dev`（`796a436a`、`bf1e40ea`）；#1467 以 changes-requested 退回；三个等作者的登记维持不动。

#1464 — 在独立 worktree 验证：`market-build --check`（dist up to date）、`skin-center:check`、`i18n:check`、`docs:check`、`community:check`、`dsh-skin validate` 全部通过；随后把 head 合入已前进 14 个提交的 `dev`，全部门禁仍绿，因此无需作者重新生成。两张 preview 均已目检：纯暗色是有意设计，皮肤有真实背景资产，不是简单改色。

#1468 — 同一组门禁通过，集成树上 `dsh-skin validate` PASS。其 `pull_request` CI 曾停在 `action_required`（首次贡献者），已放行；第一次 `Tests` 挂在 `packages/dsh-ssh` 一条与皮肤无关的代理命令 `write EPIPE` 断言上，重跑后通过。有三处选择器使用完整 CSS-modules 哈希类名（`_5OnbHa_body`、`lcKema_thinkBody`、`XrJvXW_body`）：当前安装的 host 里这些哈希仍存在，`dsh-skin validate` 也只把它们记为告警，因此作为非阻塞项记录给作者。

#1467 — 条目声明 `"npm": "@wig123/dsh-thread-tools"`，但该包未发布（`npm view` 报 E404，另查过无 scope 与其他命名变体）。`installSpec`（packages/dsh-market/src/client/install-source.ts:28）优先取 npm 字段而非 repo，因此工坊安装直接失败；修法是发布该包，或删掉 npm 字段回退到已提交 `lib/` 的 git 安装。稳定性证据其余部分缺失（仓库同日新建、无 CI、无测试套件、无 tag 或 release）；实用性过关（顶层跨会话工具补上了 `subagent` / `send_message` 没有的空缺）。仓库门禁（`community-index --check` 59 条、`market-build --check`）通过。

#1399、#1321、#1318 自 changes-requested 评审后无作者提交或回复，维持现状。

## Alternatives considered

以哈希类名阻塞 #1468 被否决：`dsh-skin validate` 把它们归为告警而非错误，当前 host 仍带这些哈希，且既有已收录皮肤已容忍同类写法；改为把脆弱性记录给作者。明知 npm 字段 404 仍合入 #1467 被否决：声明的安装路径直接失败，条目在工坊里不可用。把 #1467 按「新增能力 PR」自动关闭被否决：社区插件登记是仓库接受的内容类型，走的是强制三项分析而非关闭。未用 squash 合并：本仓库对外部贡献的惯例是标题为 `merge PR #NNNN` 的 merge 提交。本轮顺手修 `dsh-ssh` 代理命令 flake 被否决：本地无法复现（目标用例连续三次通过），`dsh-ssh` 属安全敏感包，缺乏证据的产品代码改动不合理。

## Consequences

`dev` 在 `bf1e40ea` 带上两个新皮肤；仓库目录为 32 个皮肤，`market/dist` 可干净再生成。#1467 保持打开并阻塞，直到 npm 字段被发布或移除、贡献证据门禁通过。集成分支的 push CI 因 `packages/dsh-ssh` 的 ProxyCommand 断言呈红色，与内容类 PR 无关；该 flake 在此登记为未解决缺口。

## Testing

每个 PR 独立 worktree：`node scripts/market-build --check`、`node scripts/skin-center-catalog-check --check`、`node scripts/i18n-audit.mjs --check`、`node scripts/verify-docs.mjs`、`node scripts/community-index --check`、`node scripts/dsh-skin validate <skin>`，在 #1464 与 #1468 的 PR head 与合并后的集成树上均绿。所报 flake 的目标用例 `npx vitest run tests/engine.test.ts -t "surfaces a failing ProxyCommand"`（`packages/dsh-ssh`）本地连续三次通过。