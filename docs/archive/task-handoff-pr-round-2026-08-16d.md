# 任务交接：远程 PR 集中处理轮（2026-08-16d）

> 本文件记录 2026-08-16d PR 集中处理轮的结果。执行原则：只审修复 / 增强型 PR
> 与内容贡献（社区索引登记）；全新功能 PR 按 CONTRIBUTING.md 直接关闭；
> 能合入的先本地 worktree 验证再合入，不能合入的回复评论；同时处理远程仓库的
> bug 报告 issue。执行分支：triage/pr-round-2026-08-16d（基于 origin/main
> 5f7da01c，含同步 main 的 squash 合并 f3951e8d / fcb0ac90）。

## PR 处理结果

| PR | 类型 | 结论 | 动作 |
| --- | --- | --- | --- |
| #273 fix(aionui-panel) raw 路由 Range/验证器打磨 | 修复/增强 | 已合入 | squash（fcb0ac90）。作者 EricWang1358 按模板完整填写，CI 与贡献证据检查双绿；本机隔离 worktree 全门禁 PASS。多区间 Range 按 RFC 7233 回 200 全量、raw 路由补 ETag/Last-Modified（304/If-Range）、修正测试标签 issue 笔误（#236 → #239） |
| #253 liangshen compaction 回落到受控阶段 + 降级替代抛错 | 增强/修复 | 已合入 | squash（f3951e8d）。作者按上轮评论补齐模板并 force-push，贡献证据检查转绿；本机隔离 worktree 全门禁 PASS（compaction/end 回落、边界后新信号再晋升、缺失 shell/tool 降级 warnOnce） |
| #270 Feat/mermaid plugin | 新特性 | 已关闭 | 评论说明后关闭：全新功能插件（新增 mermaid 包 + 扩展 shared 构建预设）需先经 issue #255 讨论并获维护者确认；52 文件 / +4235 行 / 约 7 MB 内联资产且与 main 冲突 |
| #237 / #209 / #205 / #6 / #63 / #91 / #101 / #104 / #105 / #168 | — | 无新变动 | 作者未按上轮评论更新，维持既有状态 |

## issue 处理结果

| Issue | 结论 | 动作 |
| --- | --- | --- |
| #274 梁神模式首轮环境感知缺失（能力类提问答错、晋升后自我矛盾） | 已处理，保持打开跟踪 | 本分支新增门控开关 phase1FirstCallInstruction（默认关，e73b4685）：开启后向 phase-1 persona 追加「先做一次 Minimal 原生工具调用再作答」的指令，promoted 阶段不注入；README 中英同步记录开关与默认形态下的限制；新增 5 个单测（77/77）。评论说明启用方式与验证口径，等待报告者按 analyze-session.mjs 指标跑门控开/关对照后再决定是否默认开启 |

## 本机验证记录

- PR #253 / #273：pr-review.mjs 在 ~/remote-e2e/pr-253、pr-273 隔离 worktree 跑
  全门禁序列（install frozen --ignore-scripts → typecheck → gallery /
  skin-center / community check → build → test → test:scripts → aggregate →
  docs:check），两项 PASS、零 findings。
- 本分支 #274 改动：liangshen vitest 77/77、全仓 typecheck、test:scripts
  （88/88）、docs:check、liangshen 包构建全绿；agent.cordis.yml 结构校验通过；
  新增行无 emoji。
- 环境：Node v25.8.1 + pnpm 11.9.0（CI 为 Node 22）。

## 遗留（下轮关注）

- #274 等待报告者 / 社区按 issue 约定的指标跑门控开/关对照：若稳定性不劣于
  98/99 基准再评估默认开启，否则维持现状（限制说明已文档化）。
- #237 / #209 / #205 作者按评论补齐模板 / rebase 后即可合入；#237 与 #227 同
  追加 community.json 尾行，合入需顺序 merge 并重新生成 community.ts。
- #189 等待报告者补充版本与层级信息；#234 等待 biaoqingbao 抽屉侧根层渲染。
