# Agent Note: 维护巡检合入 dsh-free-search rank 44，并给出四项新收录的评审结论

Status: implemented

## Problem

接续同日[上一轮记录](2026-08-29-maintenance-run-passwords-merge-free-search-approval.md)的 /pr-issue-maintenance 巡检，默认范围（assignees 包含 zhu1090093659 的开放 PR；不扫描 Issue）。本轮范围内有九个开放 PR：已批准、等待位次 rebase 的 dsh-free-search，三条维护者已给出反馈的线程，两个搁置项，以及四个全新索引收录 PR（#1277、#1279、#1282、#1285），它们的 head 都还占着尚未分配的位次。本轮要按先完成先服务裁定 rank 44 的归属，复核等待中的线程，并对四个新收录给出强制的三性结论（实用性、稳定性、兼容性）——包括对照正在运行的 0.1.2-alpha.1 profile 做 cohort 核对，因为宿主 SDK 接缝直接决定第三方插件能否加载。

## Decision

- #1249（DDDMUC，dsh-free-search）：核实并合并为 610131ebc。09:22 UTC 的 force-push（f60861952）正是预期的基于 89829ef21 的 rank 44 rebase，两文件 +25/-0 的 diff；在 head 的 detached worktree 上，`node scripts/community-index --check` 通过（44 entries），`node scripts/market-build --check` 通过（tryon/ hash 清单 756 文件，dist 为最新）。全部必需检查绿、03:25 的批准在 force-push 后仍然有效，按 squash 合并；合并后 manifest 尾部为 dsh-passwords 43、dsh-free-search 44。
- #1098（Sivan757，dsh-agent-plugins-market）：缺失的两段日志已补齐并闭环——dsh web 重启（PID 12267 到 29636）后 lifecycle-hooks suite 与 MCP/hooks 挂载按 enabled 状态恢复；PreToolUse fixture 日志显示启用期正常触发、禁用后零新增、重新启用恢复触发、卸载清除 state。head 的 CI 与 agent-notes-guard 两个 run 已从 `action_required` 放行。剩一项：rebase 到 rank 45，44 已被占用。
- #1100（termanli，dsh-fulltext-search）：2026-08-28 后无新提交；评论把位次从 44 更新为 45，与既有的空行修正一起推送。
- 四个新收录逐项深审。全部是单提交 +25/-0 的索引改动，head 本地均通过 `community-index --check` 与 `market-build --check`，但都不能落在 rank 44，因此每条结论评论都带 rank 45 rebase 指引。
  - #1277（Nath-Vikky，dsh-codekin）：三性全过，差一处描述修正。上游 CI 对着官方 dsh-v0.1.2-alpha.1 标签构建并断言 lib/ 一致，7 个 release，有生命周期与引擎测试、enable/disable 开关和原子限额持久化；client.inject 的 8 个包已逐一核对存在于本机 0.1.2-alpha.1 cohort store，engines 范围正好圈住当前 cohort。唯一缺陷：条目描述写游戏状态「保存在插件本地」，实际位置是 `$DSH_HOME/tracewild/state.json` 且未找到卸载清理逻辑，描述需写明真实路径与卸载后文件保留的事实。
  - #1279（Jamsharden，dsh-reasoning-effort）：实用性成立（索引无重复条目；对第三方 API 用户是真实缺口），阻塞在声明而非代码。没有 dsh.engines 或 README 的 cohort 声明（三个注入的客户端包已核对存在于 alpha.1），也没有卸载披露——插件写入的 llm-pi-ai settings 字段卸载后会保留。信息项：npm 0.2.0 与 0.2.3 的 gitHead 指向仓库里不存在的提交（仓库今天才建、只有一个提交），前两版来源不可核对。
  - #1282（rongxingda，dsh-prompt-enhance）：四者中实现质量最高（经 ctx.llm 走宿主凭据、回环围栏路由、超限拒绝不截断、草稿撤销栈、卸载步骤有文档、CI 全绿），但有一个硬性兼容阻塞：`@deepseek-ai/dsh-client-runtime` 在 0.1.2-alpha.1 cohort store 中不存在（上游已移除），而插件的 dsh.client.inject 依赖它、engines 下限只到 >=0.1.1-rc.1——客户端注入在运行 cohort 上无法解析。要求先发一版经 alpha.1 实测、修正 inject 与 engines 的包再收录。
  - #1285（GreenLv，dsh-completion-guard）：工程质量高（5 个 tag、CI 矩阵、测试套件、PRIVACY 与 COMPATIBILITY 文档、与撞名第三方的干净改名披露），阻塞在 cohort 验证：宿主 peer 全部钉在 ^0.1.1-rc.2 而 profile 跑 0.1.2-alpha.1，hook 的行为面（agent/session-start、agent/pre-step、agent/turn-stopping、tools.guard、update_goal deny）虽在 alpha.1 中五个宿主包都存在，却没有 alpha.1 验证记录。条目描述也需修正：「八个生命周期 hook」与实际接缝对不上，且半角标点与索引全角规范不一致。
- #1144（deepsea）与 #1245（tokyo-night）：自上轮以来作者无动静，按既有阻塞项继续搁置。

## Alternatives considered

- 把 #1277 作为最早的完整推送立即合到 rank 45：拒绝——其 head 仍声称 rank 44，合入会破坏 manifest 位次；描述修正本来也要随同一次推送落地。
- 由维护者改写过期位次的 rebase 以在一轮内落地多个收录：拒绝，理由与上一轮记录的署名与重新生成归属相同。
- 以 rc.2 cohort 仍带 dsh-client-runtime 为由把 #1282 记为非阻塞：拒绝——索引服务的是运行中的 cohort；客户端在 alpha.1 上解析不到注入的插件，等于给当前用户发布一条损坏的安装路径。
- 把 npm 0.2.0/0.2.3 的历史源码可核对性列为 #1279 的硬阻塞：不采纳——这是来源透明问题，容易补答；硬阻塞项是 cohort 声明与卸载披露。

## Consequences

- dev 从 89829ef21 前进到 610131ebc，携带 dsh-free-search 收录（44 entries，rank 44）；下一个空位是 45。六个 PR（#1098、#1100、#1277、#1279、#1282、#1285）都指向 rank 45，下一轮巡检必须重读全部线程并按先完成先服务分配位次。
- 一条可复用的评审事实入档：0.1.2-alpha.1 cohort store（`~/.dsh-cohorts/0.1.2-alpha.1/`）不含 dsh-client-runtime，今后评审可直接对照该 store 核对 inject 清单。
- 验证用 worktree 与 node_modules 链接位于 /tmp，用后已删除。本地 dev 带着另一会话的六个未推送提交，保持原样未动；本 note 经临时分支进入 origin/dev，待用户下次 push 或 pull 时由本地 dev 整合。
