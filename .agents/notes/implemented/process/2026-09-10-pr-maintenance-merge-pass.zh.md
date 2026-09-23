# Agent Note: PR 维护轮 2026-09-10 — 六个被指派 PR 全部评审并合入

Status: implemented

## Problem

维护者账号名下有六个待处理 PR：三个第三方插件登记等待首次评审（#1446 plugin-effort-slider、#1441 dsh-backup、#1438 dsh-taskfold），两个皮肤 PR 带着本账号此前的 changes-requested 评审且作者事后推了新提交（#1420 蜂虎饰件修复、#1429 blueprint 皮肤），另有一个新皮肤等待首次评审（#1449 cafe-roastery）。三个更早的登记（#1399、#1321、#1318）仍停在等作者状态。工作规则要求插件登记必须完成实用性 / 稳定性 / 兼容性三项强制分析，反馈更新 PR 只在作者回应后续审，且只从验证过的干净状态合并。

## Decision

范围内六个 PR 全部完成评审、批准并以 merge 提交合入 `dev`（#1446 13:58、#1441 14:07、#1429 14:08、#1438 14:15、#1420 14:22、#1449 14:24，UTC+8）。社区索引在本轮结束时达到 58 条，market dist 已重新生成且一致。

插件登记以证据而非 CI 绿灯放行。#1446：npm `plugin-effort-slider` 1.2.1 tarball 与仓库 `lib/client.js` 逐字节一致；零运行时依赖；客户端只注入官方服务，`conversation.input.right` 槽位在 0.1.5-alpha.2 cohort（`dsh-client-ui-conversation`）中确实存在；与 `dsh-reasoning-effort` 互补不重复（会话内控件对比设置侧编辑器）。#1441：2855 行宿主半区全部经 `subprocess.spawn` 直传参数调用 tar/git 不经 shell，凭据文件 0600 独占创建，vault 目录 go-rwx，救援台只绑 127.0.0.1；客户端无网络调用。#1438：全局工具族注册，cordis.patch.yml 自带与携带 legacy cmpct 行的 preset 冲突的文档化边界；仓库有 11 个测试套件和 ADR；npm 最新 0.33.0 落后仓库 0.34.0，已提醒作者。三者共同的非阻塞缺口：上游 package.json 均缺 `dsh.engines.dsh` 最低版本声明。

#1420 要求的三处修改在重写后的分支上全部落实（NOTICE 在源与 dist 都已改为 `selected-flower.svg`，skin.css 蜂场景注释已按花朵场景改写，README.zh 重复句已合并），且 `hooks.mjs` 与上次审查的字节相同。#1429 的 `lib/index.js` 过期 `hooksSha256` 已由作者重跑构建修复，`skin-hooks-registry --check` 通过。#1449 通过 `dsh-skin validate`，两态 preview 均目检，纯 token 的 CSS 层符合既定惯例；三处外观性问题（description 与两张背景 PNG 矛盾、order 8 与 minecraft 撞号、PR 提引用了过期工作文件名）已在 PR 上记录为不阻塞。

四个分支（#1441、#1438、#1420、#1449）在前序 PR 合入后与 dev 在生成的 market 产物或社区索引上冲突。统一处理模式：本地合并 `origin/dev`，`community.json` 按追加顺序保留各方条目，用 `node scripts/market-build` 重新生成整个 `market/dist` 而非手改清单，以 `community-index --check` 与 `market-build --check` 验证，然后经一次性命名 remote 把 merge 提交推到贡献者 fork，推送后删除该 remote 并复查 `git remote -v`。其中三个 fork 的 `pull_request` CI 停在 `action_required`，合并前逐一通过 workflow-run 审批 API 放行。#1446 上两条过期的 "Validate PR contribution evidence" 失败记录，是作者编辑 PR 描述后同工作流后来成功运行所取代的旧结果。

#1399、#1321、#1318 自 changes-requested 评审后无任何作者活动，维持不动，与 [PR 维护轮 2026-09-09](2026-09-09-pr-maintenance-skin-reviews.zh.md) 的既有记录一致。

## Alternatives considered

让作者自行 rebase 冲突分支被否决：本轮冲突纯属生成产物的机械排序，维护者可以用重新生成确定性地解决，等作者往返会让队列阻塞数天。手改四个清单 JSON 而不重新生成被否决：`market-build --check` 按源派生清单，手改可能提交出任何构建都无法复现的树。未使用 squash 合并：本仓库对外部贡献的惯例是标题为 `merge PR #NNNN` 的 merge 提交。以 description 矛盾和 order 撞号阻塞 #1449 被否决：dev 已容忍重复 order 值，两处均为外观问题，已记录给作者。在 #1420、#1449 分支 CI 未跑完时合并被否决；每次合并都等到 CLEAN 状态。

## Consequences

`dev` 带上了全部六项贡献，market 清单在 58 插件、31 皮肤、32 预设下可干净再生成。登记缺口重复了一个已知主题：上游插件仍缺 `dsh.engines.dsh` 下限声明，作者补上之前插件管理器的更新检查门控对它们不可用。fork 分支更新模式（本地合并、重新生成、一次性 remote 推送、放行 `action_required` 运行）已端到端跑通，是多合并轮次中生成产物冲突叠加时的既定菜谱。

## Testing

每个 PR 独立 worktree：`node scripts/community-index --check`（随轮次推进 56/57/58 条，最终 OK 58）、`node scripts/market-build --check`（每次均 dist up to date）、`pnpm vitest run tests/community-json.spec.ts`（每个登记 PR 2 项通过）、`node scripts/dsh-skin validate`（cafe-roastery PASS）、`node scripts/skin-hooks-registry.mjs --check`（#1429 重建后 OK）、`plugin-effort-slider` 1.2.1 npm tarball 与仓库源的 sha256 字节比对、三个插件发布代码的安全 grep（除文档化的 tar/git 调用外无网络、存储、eval、shell 面）、已装 0.1.5-alpha.2 cohort 中 `conversation.input.right` 槽位验证、cafe-roastery 两态 preview 目检。合并后本地 `dev`（与另一会话当晚两个 README 提交以 merge 整合）在 Note 提交前通过 `market-build --check` 与 `community-index --check`。
