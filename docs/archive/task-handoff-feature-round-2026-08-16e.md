# 任务交接：功能请求集中处理轮（2026-08-16e）

> 本文件记录 2026-08-16e 功能请求集中处理轮的结果。执行原则：对 open 功能请求
> issue 按「兼容性 / 低代码可维护性 / 插件运行时性能与效率」做性价比筛选，高性价比
> 的本轮实现；每个功能在基于最新 main 的独立 worktree 中串行开发与验证（同一时间只
> 处理一个功能请求），随后合并进主线；合并前 rebase / merge 到最新 main，冲突保留
> 双方更改并人工处理；同一时间只允许一个合并者。执行分支：
> feat/feature-round-2026-08-16e（基于 origin/main 65c1f0de）。

## 本轮处理结果

| Issue | 结论 | 动作 |
| --- | --- | --- |
| #169 右侧面板桌面端按钮重叠 + 文件树右键菜单 | 已实现 | 两个 CSS bug 此前已修复（950ad0a0，含 WCO 方案与回归测试）；本轮落地文件树右键菜单：复制路径 / 复制名称 / 在文件管理器中显示 / 用默认应用打开（仅文件）/ 重命名 / 新建文件 / 新建文件夹 / 删除（二次确认）；写操作全走工作区门禁（loopback 围栏 + .git 拒绝），reveal 按平台分派（Windows explorer /select、macOS open -R、Linux xdg-open 打开父目录）。commit 492b6570，包测 184/184，issue 关闭 |
| #212 会话删除 / 智能委派 / 文件树右键菜单 | 部分落地 | 「文件树右键菜单」子集本轮实现（同 #169，参考 BigRagdollCat fork 的实现方向）；「会话删除」「智能委派」两个新插件维持新插件流程（各自提 issue 讨论后按新插件流程 PR）。issue 保持打开 |
| #125 任务看板归档 | 部分落地 | 新增 archivedAt 标记（不加状态，避免污染状态机）：done/failed 可归档，归档视图切换 + 恢复，执行记录与会话 transcript 保留可追溯；running/未结算任务拒绝归档；老数据无字段默认未归档，无需迁移。commit a809e571，包测 163/163。剩余（台账 host 化、Agent 工具入口、自动归档）继续跟踪，issue 保持打开 |
| #179 移动端 Markdown + KaTeX | 部分落地 | GFM 子集落地：零依赖自写渲染器（escape-first + 协议白名单，移植桌面预览渲染器），assistant 消息渲染标题/加粗/斜体/行内码/代码块/列表/表格/引用/链接/图片，用户消息保持纯文本；长回复按渲染块高度折叠（不截断半截围栏）；移动端 bundle 464KB → 475KB（+2.3%，gzip +约2KB），远低于 marked+dompurify 参考实现的 1.1MB。commit aa381a9c，包测 202/202。KaTeX 留待后续（字体路由 + nonStandard 中文标点 + 体积预算单独评估），issue 保持打开 |
| #255 mermaid 渲染（面板预览侧） | 部分落地 | PR #277（kop022）经本地隔离 worktree 全门禁验证后合入：懒加载同源 vendor 资产 3.4MB（gzip 975KB）、构建期从 npm 拷贝、loopback 围栏、ETag 再验证、无 CDN、strict 安全档、语法错误还原纯代码块、client bundle 无增长。维护者修复：mermaid 移为 devDependency（消费端不装依赖树）、补全 lockfile（原 PR 缺失包条目致 frozen install 失败）。原提交 611503f7 保留作者署名 + 修复提交 f4ffa370。官方会话转录侧仍待核心 CodeBlock 输出 language-mermaid 类（当前为惰性观察器），issue 保持打开 |

## 未选中（回复说明、保持打开跟踪）

| Issue | 结论 |
| --- | --- |
| #228 子目录 git 仓识别 | 部分场景已支持（工作区是外层仓库子目录，rev-parse 自愈探测 + 回归测试）；真正缺口「工作区内嵌套独立 .git 仓」需 SCM 单一 status 改多仓 map（200-400 行，中-高风险），本轮暂缓 |
| #279 侧边对话访问主界面上下文 + 不同模型 | 上下文访问插件侧可行（SDK session face）；「不同模型」受限于 ISession.prompt() 无 model 参数、模型由 agent 预设组合唯一决定且 ISessions 无 create——需核心支持，建议向上游提需求 |
| #272 鲸鱼娘原版/精致版皮肤切换 | 方向认可（PR #268 实现路径正确），硬阻塞是素材授权：issue 自述精致版为网络二次创作素材、非完全原创，仓库无 THIRD_PARTY 记录；请补充授权说明或替换素材，并 rebase + 全门禁后重新提 PR |
| #271 Codex/CC 配置与对话迁入 | 新功能面 + 读其他 harness 配置目录（可能含凭据）的安全评审，需先细化输入源与安全模型；本轮暂缓 |
| #197 / #85 / #194 / #188 / #128 / #164 / #266 | 维持上一轮（2026-08-16d）结论，状态不变 |

## 本机验证记录

- 四个功能分别在独立 worktree（/tmp/dsh-web-ui-fr-menu / -archive / -gfm /
  -mermaid，均基于 origin/main 65c1f0de）开发并跑包级门禁；round 分支组装后在
  /tmp/dsh-web-ui-fr-verify 全量复验：typecheck、pnpm test（22 包全绿）、
  test:scripts、docs:check、aggregate:check、gallery:check、skin-center:check、
  community:check、runtime-deps:check、全仓 build（44 目标）全绿；mermaid vendor
  资产构建期拷贝产出正常（3,566,058 B）。
- 包级增量：aionui-panel 168→184 用例（菜单 fs/routes/store 12 个 + mermaid 12 个，
  mermaid 与本轮菜单在 mermaid worktree 分头验证）；task-board 159→163（归档 4 个）；
  remote-web-ui 192→202（markdown 10 个）。
- 冲突处理：合并回 main 时与并行会话的 fix(task-board)（2136b376，调度器防僵尸触发）
  在 controller.ts / README / controller.spec.ts 冲突——双方更改均保留（归档动作与
  reloadFromStore 并存，README 双段说明并存），人工解决后 task-board 全量重跑。
- 环境：Node v25.8.1 + pnpm 11.9.0（CI 为 Node 22）。

## 遗留（下轮关注）

- #125 台账 host 化 + Agent 工具入口（依赖 host 化）；自动归档选项。
- #179 KaTeX：字体路由 + nonStandard 中文标点 + 体积预算，建议独立评估。
- #255 会话转录侧渲染依赖核心 CodeBlock 语言类；PR #270 完整方案继续跟踪。
- #272 等待报告者补齐素材授权；#279 / #228 / #271 等待上游或细化后继续。

