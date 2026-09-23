# Agent Note: PR maintenance run 2026-09-12 (fourth pass) — whalechan skin and jyn pet content/persistence merged

Status: implemented

## Problem

`zhu1090093659/dsh-web` 的第四次维护巡检，距第三轮数小时。默认范围：分配给维护者账号的八个开放 PR（新的 jyn 宠物 PR #1499 加入了第三轮的七个），不扫描 Issue。第三轮结束时七个 PR 全部阻塞在作者侧；本轮要回答的是：作者是否有动作，以及两个出现活动的 PR 能否过闸。

## Decision

合并两个 PR，其余六个保持开放且阻塞在作者侧。

#1484（whalechan 工坊皮肤）：作者按第三轮要求删掉了仅维护者可用的 Agent Note 三件套（提交 5cefe4425e，纯删除）。fork 的必需检查一直卡着，因为 `pull_request` 事件的工作流（CI、agent-notes-guard）处于 `action_required` 等待维护者批准；两个运行（34669149915、34669149894）经 runs API 批准后全部变绿，PR 以 merge commit 合入（eb41ec213）。

#1499（jyn 冰晶公主宠物内容加皮肤选择持久化，850 个文件，两侧各 415 个新帧资产）：作为一个整体评审。内容配置自洽——三个点击动作按 0.3333 / 0.3333 / 0.3334 分摊，休息与工作轨循环，结果轨非循环且 fallback 指向皮肤自己的工作轨，`gameplayTracks` 的键与 manifest 的 `work.successState` / `failState` 一致，10s / 50% 判定保持在宠物级、皮肤只换画面。持久化功能由宿主做权威：`set-skin` 按 manifest 校验，`persist.ts` 清洗过期条目，客户端被拒时回滚到宿主当前值，总线锁存 `idleTrack`，迟到或重挂载的渲染器仍能恢复所选皮肤——与 sleep 轨皮肤覆盖既有模式一致。在 PR head 的独立 worktree 本地复核：dsh-pet 全量 42 个文件 505 个用例通过；head 上的 CI checks、guard-agent-notes、plugin-mount、Windows 单测全绿。已批准并合入（ce18796f4）。

其余六个只读复核：所有 review 仍为维护者所留、作者无动作，不进入复审。#1488 保持已批准但 CI 红在 `plugins.json` subcategory 契约；#1479、#1467、#1399、#1321、#1318 维持此前各轮记录的 changes-requested 阻塞项。

## Alternatives considered

不批准排队的工作流运行直接合 #1484 不可行——ruleset 要求这些检查，批准是前置条件而非礼节。拒绝 squash merge：仓库历史对外部 PR 用 merge commit，保留作者提交边界。拒绝把缺失的 `subcategory` 修复直接推到 #1488 的 fork：第三轮确立的规范是 fork 推送只承载 rebase 更新、不带内容改动，且该分支仍在活跃提交。拒绝把 #1499 拆成内容与功能两个 PR：作者提出过可拆，但两半共享 manifest、测试与生成产物，且描述已披露按一个整体提交并评审。

## Consequences

whalechan 皮肤与 jyn 内容/持久化已进入 `origin/dev`。后续宠物皮肤可依赖总线锁存契约（`GameplayBus.idleTrack`）与宿主 `setSkin` RPC；评审未来捆绑功能改动的内容 PR 时，应继续核查共享判定规则保持在宠物级。fork 审批步骤已记录备用：首次或无权限的 fork PR 的 CI 会一直排队，直到维护者经 `POST /actions/runs/{id}/approve` 批准运行。六个 PR 仍阻塞在作者侧；最久的 #1318、#1321 已十二天无作者动作。

## Testing

GitHub 状态经 `gh pr view` / `gh run list` / `gh api`（reviews、评论、检查、合并状态）。#1499 在 ffb728b300 的独立 worktree 本地复核：`pnpm install` 后在 `packages/dsh-pet` 跑 `pnpm test`——42 个文件 505 个用例全过。合并确认进入 `origin/dev`（eb41ec213、ce18796f4）后，评审 worktree 与临时分支已删除。
