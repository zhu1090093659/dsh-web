# 任务交接：远程 PR 集中处理轮（2026-08-17）

> 本文件记录 2026-08-17 PR 集中处理轮的结果。执行原则：只审修复 / 增强型 PR
> 与内容贡献（社区索引登记、文档、测试、皮肤）；全新功能 PR 按 CONTRIBUTING.md
> 直接关闭（有维护者回复的除外）；同时处理远程仓库的 bug 报告 issue（冒烟测试 +
> 引用代码 + 补丁三要素齐全的本地验证后修复）。执行分支：
> triage/pr-round-2026-08-17（基于 origin/main f57b766a；worktree 验证基线随
> origin/main 滚动更新）。并发纪律：每 PR 一个独立 worktree
> （/tmp/dsh-triage-17/pr-<N>，从 PR head 检出），合并由单一维护者串行执行；
> 合入前逐个 rebase 到最新 origin/main，冲突按「保留双方」解决后 head 回推
> 作者分支（force-with-lease 校验旧 head）。共享文件（community.json /
> skin-center 生成产物）的 PR 串行处理。并行功能轮会话（feat/feature-round-2026-08-17b）
> 同步在跑，本轮的关闭 / 合并与其按「同一 PR 不双人操作」切分执行。

## PR 处理结果

| PR | 类型 | 结论 | 动作 |
| --- | --- | --- | --- |
| #368 community 注册 dsh-auto-memory | 内容登记 | 已合入 | squash（e9a76e62）。上游公开、npm @a9i5k4/dsh-auto-memory 0.1.26 可达、条目与上游 README 一致；community:check 15 entries in sync |
| #357 community 注册 dsh-memoir | 内容登记 | 已合入 | squash（7a3116a4）。上游公开、v0.4.1 能力（BM25 检索 / 记忆诊断面板）与条目一致；npm 未发布故条目无 npm 字段（契约允许）；与 #368 在 community.json 尾部冲突，rebase 后按保留双方解决（auto-memory + memoir 并存，16 entries，community-index 重生成），head 回推作者分支（6054ebd4，force-with-lease 校验 f02fbef1） |
| #366 feat(describe-image) 思考档位后缀 | 增强 | 已合入 | squash（84e5c119）。148/148、typecheck、docs:check 全绿；未知后缀（OpenRouter :free / Replicate :version）原样保留、无后缀不发思考字段；3 条 LOW 小项留档（后缀列表与正则重复定义、'model :off' 尾部空格、双后缀 last-wins 与文档措辞） |
| #370 docs 手工升级清单扩展 | 文档 | 待作者修正 | 评论 2 处事实修正：community-plugins 是 0.1.18 起的新子包（非 0.1.19）；四个皮肤包 0.1.19 仍独立发布、link-profile 链接到 packages/skins/<name> 源目录、无「版本不匹配」强制校验，步骤 3 需改写 |
| #369 fix(aionui) 恢复展开目录重灌 | 修复 | 待作者补一行 | 代码复验通过（210/210、typecheck、docs:check；rebase 干净）；唯一阻塞：PR 描述「最新代码确认」未勾选标准行致证据检查红，评论要求改为标准勾选行 |
| #347 feat(skins) whale-mom 皮肤 | 新皮肤 | 已合入 | squash（3bcdb348）。BACKDROP_SKIN_IDS 已登记 + bundle 重建，whale-mom 3/3、skin-center 99/99、skin-center/gallery/aggregate/docs 全绿；与 main 的生成产物冲突（lib/client.js.map）按保留双方解决（重建 bundle 同时含 main 文案修复与 whale-mom 条目），head 回推作者分支（e0fb14eb，force-with-lease 校验 0793ff1c） |
| #340 feat(skins) matrix 皮肤 | 新皮肤 | 已合入 | squash（57bf8b98）。dsh-skin 注册表、试穿中和（NEUTRALIZE_CSS + captureAndRetractActive）、DPR 上限、order 去重全部落实；matrix 6/6、skin-center 101/101、test:scripts 91/91、skin-center/gallery/aggregate/docs 全绿（12 skins）；map/gallery/skins.ts 生成产物冲突按保留双方重建（matrix + whale-mom + main 文案并存），head 回推作者分支（370d50ad，force-with-lease 校验 c1132282） |
| #355 docs 自定义壁纸皮肤指南 | 文档 | 待作者改一行 | token 值 23/23 与 blue-fantasy 一致、预算已登记、docs:check 与 test:scripts 全绿、模板补齐；唯一遗留：第四节「滑块只对白名单皮肤显示」与实现不符（滑杆全部渲染、白名单只决定提示与生效），已评论要求改为「显示但对非白名单皮肤不生效」 |
| #373 feat(community-plugins) 市场 API 接入 | 全新功能 | 已关闭 | 并行功能轮会话关闭（无评论）；本会话补发标准关闭评论：全新功能超出范围 + 外部 PR 不得改 .github/workflows / CONTRIBUTING / PR 模板 + 证据检查红，指引 #365 讨论 |
| #364 feat(task-board) Host 调度 + 息屏保活 | 全新功能 | 已关闭 | 评论说明后关闭：#344 同口径（#313 讨论准入），已确认本 PR 未改 CI 文件、模板完整——仅准入问题 |
| #367 feat(remote-web-ui) 消息编辑 + 自动重试 (#316) | 全新功能 | 已关闭 | 维护者侧已有同主题本地实现（feat/issue-316-edit-retry，待人工审核），外部重复实现关闭；思路留作 #316 对照 |
| #276 / #237 / #205 / #168 / #104 / #101 / #6 / #358 | — | 无新变动 | 作者未按上轮评论更新，维持既有状态（下轮继续跟踪） |

## issue 处理结果

| Issue | 结论 | 动作 |
| --- | --- | --- |
| #363 remote-web-ui 隧道未就绪卡 lan-required | 已修复 | 冒烟测试 + 引用代码 + 补丁三要素齐全，本地复现路径成立；修复 28f3553a（lan-required 也订阅 SSE、running 跳变自动重新 issue、fence 来源不订阅 + 3 个回归测试，remote-web-ui 204/204）合入 main 后关闭（completed） |
| #359 / #356 皮肤应用提示误导 + 热切换诉求 | 部分修复 | 提示文案修复 df60a749（区分开发模式刷新 / 打包版重启）合入 main；免重启热切换与 DSH_SKINS_DIR 动态列表属增强，保持打开跟踪（enhancement） |
| #374 / #365 | 已分类 | 打 enhancement 标签 |
| #302 / #303 / #292 / #234 / #189 / #317 | 跟踪中 | 无新信息（#302 待 #205、#303 待 #101、#292 待 #104、#234 待抽屉侧根层渲染、#189 待报告者补信息、#317 待报告者复现证据），保持打开 |

## 本机验证记录

- 每 PR 独立 worktree（/tmp/dsh-triage-17/pr-<N>），pnpm install
  --frozen-lockfile --ignore-scripts（3-5s，共享 pnpm store），门禁按受影响面跑
  （受影响包 test + typecheck + docs/community/skin-center/gallery/aggregate/
  test:scripts 相关项），结果见上表。
- #357 与 #368 的 community.json 尾部冲突按保留双方解决（cloud-sync + auto-memory
  + memoir 三条目并存），community-index 重生成后 16 entries in sync，head 回推
  作者分支。
- #363 修复走本地 worktree（wip/triage-fix-363）实现并提交后 rebase 推 main；
  #359/#356 文案修复同路径（wip/triage-fix-356，含 lib 客户端 bundle 重建）。
- 合并树（origin/main 随合并滚动更新）逐次核对：合并与推送均由本轮单一口径
  串行执行，推送前 rebase 最新 origin/main。

## 遗留（下轮关注）

- #370 作者按评论修正两处事实后即可合入；#369 补标准勾选行后即可合入；
- #355 作者改完第四节措辞后即可合入；
- #205（对应 #302）、#276、#237、#104（对应 #292）、#101（对应 #303）等作者
  补完模板 / 拆分后继续处理；
- #6 / #358 维持许可裁决阻塞；#358 已转 ready，待作者补 LICENSE/NOTICE 与
  授权说明、场景包装层 data-skin-chrome 后复审；
- #359 / #356 的热切换与动态列表诉求待维护者评估常驻模块方案。
