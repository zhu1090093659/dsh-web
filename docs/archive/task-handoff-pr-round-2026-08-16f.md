# 任务交接：远程 PR 集中处理轮（2026-08-16f）

> 本文件记录 2026-08-16f PR 集中处理轮的结果。执行原则：只审修复 / 增强型 PR
> 与内容贡献（社区索引登记、文档、测试）；全新功能 PR 按 CONTRIBUTING.md
> 直接关闭；能合入的先本地 worktree 验证再合入，不能合入的回复评论；同时处理
> 远程仓库的 bug 报告 issue。执行分支：triage/pr-round-2026-08-16f（基于本地
> main 74a3a8a2；worktree 验证基线为 origin/main，逐个合入后滚动更新）。
> 并发纪律：每 PR 一个独立 worktree（/tmp/dsh-triage-16f/pr-<N>，从 PR head
> 检出），合并由单一维护者串行执行（本轮 7 个 PR 逐个 squash 合入）；合入前
> 冲突 PR 先 rebase 到最新 origin/main，冲突按「保留双方」解决后 head 回推
> 作者分支（force-with-lease 校验旧 head）。共享文件（community.json /
> skin-center.module.css）的 PR 串行处理。

## PR 处理结果

| PR | 类型 | 结论 | 动作 |
| --- | --- | --- | --- |
| #312 fix(live-stats) 位置化折叠 | 修复 | 已合入 | squash（2e8cc2ea）。surface 从 Record 改为模型可见顺序数组，replace 按位置折叠；live-stats 30/30、全仓 typecheck、docs:check 全绿；stateVersion 升至 v4 |
| #311 fix(aionui) details 把手补偿 | 修复 | 已合入 | squash（63f0684e）。作者按上轮 6 点补全模板并附真机截图，证据检查转绿；aionui-panel 193/193、typecheck、docs:check 全绿 |
| #318 community 注册 deepseek-harness-auth | 内容登记 | 已合入 | squash（d55b4591）。仓库公开、npm 0.4.1 可达；合入前 rebase 到 #312/#311 之后的 main，community.json 尾追加冲突按双方保留解决（13 entries），head 已回推 JAVA-LW 分支（force-with-lease 校验 5e9a8522）；community:check 13 entries in sync、11/11 |
| #343 fix(skin-center) 滑杆轨道语义色 | 修复 | 已合入 | squash（dd742962）。与本地 #309 修复（9fd97bf2）重叠，按「保留双方」合并：语义色 color-mix 轨道 + 描边 + 显式 webkit/moz 轨道样式并存，重建 lib bundle；合并树 skin-center 98/98（含 3 个守卫测试）、skin-center:check 绿 |
| #291 docs deepread 条目同步 | 文档 | 已合入 | squash（40666027）。作者按上轮评论补全模板并 rebase（14:38 新 head），证据检查转绿；条目与 v0.5.4 一致，community:check 13 entries in sync |
| #348 community 注册 dsh-cloud-sync | 内容登记 | 已合入 | squash（a3403c23）。仓库公开、npm @dickpy/dsh-cloud-sync 0.19.1 可达，条目与上游 README 一致；community:check 14 entries in sync、11/11。轮末新到 PR，追加处理 |
| #345 fix(web-ui-settings) 认证代理桥 | 修复/增强 | 已合入 | squash（1ad05e17）。安全复核：默认仅 loopback，代理模式需 loopback socket + 精确 Host 白名单 + 同源标记 + 环境变量令牌（timingSafeEqual，浏览器不可见），客户端未配置时 403 保持 unavailable；README 含安全模型与 Caddy 示例；web-ui-settings 50/50、test:scripts 90/90、typecheck、docs:check 全绿。issue #342 关闭 |
| #340 feat(skins) matrix 皮肤 | 新特性 | 已关闭 | 评论说明后关闭：新增皮肤属全新功能，超出修复/增强/内容登记范围；#218 曾以「请走 PR」关闭，建议重开 issue 确认准入 |
| #344 feat(task-board) 息屏保活 | 新特性 | 已关闭 | 评论说明后关闭：新增能力超出范围，且外部 PR 修改 .github/workflows/ci.yml（供应链安全直接拒绝）+ 缺功能证据；请先到 #313 讨论 |
| #347 feat(skins) whale-mom 皮肤 | 新特性 | 已关闭 | 评论说明后关闭：与 #340 同口径；另 PR 描述未按模板填写（摘要/类型/最新代码确认/本地验证/AI 披露全缺） |
| #205 / #209 / #304 / #276 / #237 | — | 无新变动 | 作者未按上轮评论更新，维持既有状态（下轮继续跟踪） |
| #168 / #104 / #101 / #6 | — | 无新变动 | 维持既有状态（#168 待拆分；#104 待补模板；#101 部分已被 main 覆盖；#6 draft 待许可裁决） |

## issue 处理结果

| Issue | 结论 | 动作 |
| --- | --- | --- |
| #317 Markdown 图片预览开关异常 | 已修复 | 本地复核 lightbox 代码：重复开合幂等、遮罩打开前先清理、失败路径记住后不重建，均无问题；唯一实锤是关闭时 trigger.focus() 默认滚动会拉回页面。修复 eb2efd78（focus({ preventScroll: true })）+ 2 个回归测试（3 轮开合幂等 + preventScroll 调用断言），describe-image 142/142；留言说明并要求复现证据 |
| #342 认证反向代理设置桥 | 已实现 | PR #345 合入后关闭（completed）并留言 |
| #341 桌宠交互扩展 | 已回复 | 留言：对照已关闭的 PR #305/#306，两项诉求在本 issue 统一讨论并补充节奏语义 |
| #294 anthropic-messages 协议 | 已回复 | 留言：同意通用协议诉求，保持开放跟踪；实现时以 apiStyle: anthropic-messages 为验收口径 |
| #320 设置项未折叠进卡片 | 已回复 | 截图复核：红框 5 项是刻意的一级设置分区（设置页重组设计），非布局异常；留言说明并请补充期望折叠形态 |
| #313 / #314 / #315 / #316 / #308 / #301 / #307 / #346 | 已分类 | 打 enhancement 标签（#307 已回复过：aionui-panel 将内置 better-sidebar） |
| #302 / #290 / #292 / #234 / #189 / #303 | 跟踪中 | 上轮已定位/回复，无新信息，保持打开 |

## 本机验证记录

- 6 个 PR worktree（/tmp/dsh-triage-16f/pr-<N>）逐个从 PR head 检出、独立
  pnpm install（--frozen-lockfile --ignore-scripts），门禁按受影响面跑
  （typecheck + 受影响包 test + docs/community/skin-center/test:scripts 相关项），
  结果见上表；#318/#291 的 community.json 冲突按「保留双方」解决并回推作者分支。
- #343 与本地 #309 修复重叠：合并树皮肤中心轨道 = 语义色 color-mix 轨道 +
  border-l3 描边 + 显式 webkit/moz 轨道规则（两处修复并存），重建 lib bundle
  后 skin-center 98/98。
- #317 修复：describe-image 142/142（含 2 个新回归测试）。
- 最终合并树全量门禁：typecheck、test:scripts、docs:check、community:check、
  skin-center:check、aggregate:check 全绿。
- 环境：Node v25.8.1 + pnpm 11.9.0（CI 为 Node 22）。

## 遗留（下轮关注）

- #205 / #209 / #304 / #276 / #237 按本轮回帖补完后即可合入；#205 对应 #302、
  #304 对应 #290，合入后关闭对应 issue。
- #317 修复已随 main 推送；若报告者在新版本仍能复现「图片重复/遮罩残留」，
  需补充录制或按键序列（尤其是否发生在流式更新、压缩或切会话期间）。
- #340 / #347 的皮肤准入诉求在各自评论中已指引重新开 issue；#344 的息屏保活
  请报告者到 #313 讨论后再提交（且不得修改 CI 文件）。
- #234 / #189 等报告者补充版本与层级信息。
