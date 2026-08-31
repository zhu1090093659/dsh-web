# Agent Note: Maintenance run merges dsh-passwords at rank 43, approves free-search, narrows two parked threads

Status: implemented

## Problem

接续[上一轮记录](2026-08-28-maintenance-run-catppuccin-acceptance-notion-skill-merge.md)的 /pr-issue-maintenance 巡检，默认范围（assignees 包含 zhu1090093659 的开放 PR；不扫描 Issue）。本轮范围内有六个开放 PR，全部处于维护者账号已介入的对话中段，其中三个索引收录 PR（#1224、#1249、#1100）各自 rebase 后都在争夺上一轮腾出的 rank 43 尾部队列位。本轮需要决定该位次的合并顺序，逐项复核各作者此后推送的遗留项，并让其余线程继续推进，不重翻已定的结论。

## Decision

- #1224（slywalker2006，dsh-passwords）：核实并合并为 8b1615959。rebase 提交（cf1978fc）收敛为两个文件、+25 行、零删改行；在 PR head 的 detached worktree 上，`node scripts/community-index --check` 通过（43 entries），`node scripts/market-build --check` 通过（tryon/ hash 清单 756 文件，dist 为最新生成结果），manifest 尾部确认 dsh-passwords rank 43、远程访问网关 / Access Gateway、security/access。head 的 CI 与 agent-notes-guard 两个 run 从首次贡献者 `action_required` 门控放行后均绿；按 ruleset 要求提交了正式 approving review（线程评论不算批准），随后 squash 合并。合并后的 dev tip（8b1615959，43 entries）在 fast-forward 后通过 `market-build --check` 与 `community-index --check`。
- #1249（DDDMUC，dsh-free-search）：三项必改逐项核实完毕，PR 已批准。中英双语接管披露在 diff 里（searchProvider=ddg 接管加 rollbackPatch 恢复，付费引擎需各自 key）；部署复现文档按 raw 链接抓取核对，含五步记录（安装、接管、无 key 真搜、设置面板、卸载恢复 deepseek-official）；rank 43 的 rebase diff 干净。本地复核与 #1224 同标准（43 entries、market-build --check、manifest 尾部 免费搜索 / Free Search），CI/plugin-mount/guard-agent-notes 已绿；approving review 要求再推一次：rebase 到 rank 44，因为 #1224 拿走了 43。作者自己标注的 alpha.1 缺口（alpha.1 client 路由重构下插件 client bundle 路由 404，宿主侧接缝不受影响）按条目面向的稳定版口径记为非阻塞。
- #1100（termanli，dsh-fulltext-search）：两件遗留项在推送的提交中核实完成——`.agents/notes` 三件套相对 dev 净变更为零，重新生成的 manifest 通过 `market-build --check`（rank 43，tools/dev）。这轮重建引入一个新缺陷：community.json 条目与收尾 `]` 之间有 13 个空行（生成器会忽略它们所以 `--check` 仍通过，但手工维护的源文件被污染）。CI 与 agent-notes-guard 门控已放行，评论要求一次推送：删空行、rebase 到 rank 44、重新生成。
- #1098（Sivan757，dsh-agent-plugins-market）：索引侧评审项已关闭——subcategory tools/dev 在 diff 里，manifest 已重新生成，lockCommit 确认弹窗项随上游 0.5.3 发布。剩余证据收敛为两段日志（dsh web 重启后 suite 与 MCP/hooks 挂载按 enabled 状态恢复；禁用或卸载 suite 后 hooks bridge 运行时确实停止——2026-08-25 的 MCP 禁用/卸载记录仍有效，无需重跑）。Windows 验证按作者无硬件的客观限制豁免，记为维护者侧后续验证项；CI 与 agent-notes-guard 门控已放行，评论同时指明届时还需 rebase 重排位次。
- #1245（tokyo-night）与 #1144（deepsea）：自上轮以来作者无动静，按既有阻塞项继续搁置（无水印素材；changes-requested 清单）。

## Alternatives considered

- 由维护者手工重排第二、三个收录条目以在一轮内落地多次合并：拒绝，按既定规则重新生成与 rebase 应留在贡献者分支并过必需检查；维护者改写 fork 分支还会搅动作者署名。
- 先合并 #1249 再合并 #1224：拒绝，按先完成先服务——#1224 的内容结论 04:45 UTC 落地，早于 #1249 的 15:02，且其 rebase 推送（05:35）最早。
- 全部豁免 #1098 的未落实证据：拒绝；重启恢复与 hooks 停止是该插件的核心生命周期主张，必须保留。只有 Windows 项转为维护者侧后续验证。
- 把 #1249 的批准押后到其 rebase 之后：考虑过但不采纳；现在提交批准记录了已完成的核验，若仓库在 rebase 推送时撤销过期 review，对只差 rank 号的 diff 重批是机械操作。

## Consequences

- dev 从 fcc6caa4e 前进到 8b1615959，携带 dsh-passwords 收录（43 entries，rank 43）；tip 上 `market-build --check` 与 `community-index --check` 通过。
- #1249 与 #1100 都被指向 tip 8b1615959 的 rank 44；同日推送会再次撞位，下一轮巡检必须重读两条线程并按先完成先服务重新分配位次。
- #1098 的验收路径是一次推送：两段日志加位次 rebase（届时为 44 或下一个空位）；#1100 是删空行加同样的 rebase；#1249 内容已完整，等它的 rebase 推送。
- 验证用 worktree 与 node_modules 链接位于 /tmp，用后已删除；除本 note 提交与到远程 tip 的 fast-forward 外，未改动共享 checkout 状态。
