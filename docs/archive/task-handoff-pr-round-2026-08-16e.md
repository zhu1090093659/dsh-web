# 任务交接：远程 PR 集中处理轮（2026-08-16e）

> 本文件记录 2026-08-16e PR 集中处理轮的结果。执行原则：只审修复 / 增强型 PR
> 与内容贡献（社区索引登记、文档、测试）；全新功能 PR 按 CONTRIBUTING.md
> 直接关闭；能合入的先本地 worktree 验证再合入，不能合入的回复评论；同时处理
> 远程仓库的 bug 报告 issue。执行分支：triage/pr-round-2026-08-16e（基于本地
> main ee3b17b0；worktree 验证基线为 origin/main 0ea284c3，逐个合并后滚动更新）。
> 并发纪律：每 PR 一个独立 worktree（/tmp/dsh-triage-16e/pr-<N>，均从最新
> origin/main 检出后 rebase PR head）；共享文件（community.json、board.module.css、
> 根 README）的 PR 串行合入，合入前逐个 rebase 到最新 origin/main 并保留双方改动。

## PR 处理结果

| PR | 类型 | 结论 | 动作 |
| --- | --- | --- | --- |
| #278 fix(git-graph) 暗色主题分支切换横幅不可见 | 修复 | 已合入 | squash（4a6bb970）。根因 primary/secondary 同色别名，改 color-mix 半透明底 + primary 文字；git-graph 80/80、CI 双绿。issue #275 自动关闭 |
| #299 community 注册 dsh-plugin-hub | 内容登记 | 已合入 | squash（e65e004f）。community:check 10 entries in sync，证据检查绿 |
| #293 community 注册 dsh-genui + dsh-annotation（+README 友情链接） | 内容登记 | 已合入 | squash（3beebb90）。合入前 rebase 到 #299 之后的 main，community.json 尾追加冲突按双方保留解决（12 entries），head 已回推作者分支；docs:check 绿 |
| #298 fix(task-board) 移动端列布局 | 修复 | 已合入 | squash（f0ae6a6e）。task-board 175/175（含新 CSS 回归 5/5），证据检查绿。合入后留言两点说明：1148px 以下容器横向滚动（描述应如实）、归档视图整板宽属行为变化需确认。issue #296 自动关闭 |
| #289 fix(task-board,ssh) 返回会话入口 | 修复 | 已合入 | squash（603ebecd）。合入前 rebase 到 #298 之后的 main（board.module.css 无冲突）；task-board 175/175、ssh 85/85。issue #285 自动关闭 |
| #91 docs pnpm minimumReleaseAge 告警 | 文档 | 已合入 | squash（0cad6a6a）。作者按上轮评论补齐模板并 rebase（更新基于反馈）；docs:check 绿，证据检查转绿。合入前 rebase 到 #293 之后的 main（README 无冲突） |
| #286 feat(pet-center) 鲸鱼娘皮肤切换 | 新特性 | 已关闭 | 评论说明后关闭：新增 pet-center 切换面板 + dsh-pet-maid 新包超出修复/增强/内容登记范围，需先 issue #272 讨论确认 |
| #295 feat(describe-image) anthropic-messages 协议 | 新特性 | 已关闭 | 评论说明后关闭：新增协议接入属全新功能，需先 issue #294 讨论确认 |
| #305 feat(pet) 多 GIF 序列轮换 | 新特性 | 已关闭 | 评论说明后关闭：渲染能力层面新特性（播放节奏语义 + 资产格式扩展） |
| #306 feat(pet) 反馈语料池 + 面板移位 | 新特性 | 已关闭 | 评论说明后关闭：新交互能力（轮换机制 + 面板定位变更） |
| #105 fix(skins) tooltip 对比度 | 已被 main 覆盖 | 已关闭 | 1c84c69 等价覆盖（--dsw-alias-tooltip-fg 成对声明），评论说明后关闭 |
| #63 fix(git-graph) branch chip 位置 | 已被 main 覆盖 | 已关闭 | b657af1 + a30e38e + fcaddec 等价覆盖，评论说明后关闭 |
| #205 fix(liangshen) cpSync CJK 崩溃 | 修复 | 请求变更 | 代码复核通过（copyTreeSync 语义等价；typecheck + 78/78 全绿），证据检查转绿；缺「AI 编码披露」与「仓库规范检查」两节，已留言补完即合入 |
| #209 test(skins) trading 断言 | 测试 | 请求变更 | 代码此前已复核（trading 18/18 + docs:check 绿）；「最新代码确认」勾选行尾多括号备注导致证据检查红，已留言逐字修正 |
| #304 fix(skins) managed patch 移入 profile | 修复 | 请求变更 | 代码与门禁全绿（skin-center 96/96、test:scripts 91/91、skin-center:check、docs:check），修复方向正确（#290）；需补用户可见变更截图证据（或取消勾选）+ 同步 3 处旧路径文档 |
| #311 fix(aionui) details 把手位置补偿 | 修复 | 请求变更 | 代码复核通过（与官方 DragHandle 定位公式对照成立；typecheck + aionui 193/193 绿）；PR 描述未用模板，已留言补全并附截图 |
| #276 fix(remote) 侧边栏入口 | 修复 | 请求变更 | 代码与门禁全绿（remote-web-ui 203/203、docs、aggregate）；README.i18n.yaml 冲突本机按双方内容合并验证；描述未用模板（英文节），已留言补模板 + 截图 + rebase |
| #291 docs deepread 条目同步 | 文档 | 请求变更 | 条目与上游 v0.5.4 一致、community:check 通过；描述未用模板，已留言补全 |
| #237 community 注册 6 插件 | 内容登记 | 请求变更 | 内容复核通过（仓库公开、6 包可达）；本机已把 6 条目并入新路径 community.json 并重生成（15 entries in sync）；描述未用模板且指向已迁移的旧文件路径，已留言 |
| #101 / #104 / #168 / #6 | — | 无新变动 | 作者未按上轮评论更新，维持既有状态（#101 部分已被 main cf46c04 覆盖；#104 待补模板；#168 待拆分；#6 draft 待许可裁决） |

## issue 处理结果

| Issue | 结论 | 动作 |
| --- | --- | --- |
| #309 默认外观下滑杆轨道不可见 | 已修复 | 本分支修复：官方浅色主题 layer-1/2/3 同白导致轨道隐形，加 border-l3 描边 + 显式 webkit/moz 轨道样式（9fd97bf2），新增 3 个 CSS 源守卫测试（skin-center 98/98），Playwright 官方 token A/B 渲染验证。issue 关闭（completed）并留言 |
| #275 git-graph 暗色横幅 | 已修复 | PR #278 合入后自动关闭（completed） |
| #285 任务看板/SSH 返回入口 | 已实现 | PR #289 合入后自动关闭（completed） |
| #296 任务看板移动端布局 | 已实现 | PR #298 合入后自动关闭（completed） |
| #302 liangshen Windows 启动崩溃 | 已定位 | 根因 fs.cpSync 在 Node 22 + Windows + CJK 路径原生崩溃（nodejs/node#54476）；PR #205 即修复（本机已验证），留言说明并等作者补模板后合入 |
| #290 dsh-tui 崩溃 | 已定位 | PR #304 即修复（本机已验证），留言说明并等作者补证据与文档 |
| #303 微信输入法改名闪退 | 已回复 | 留言：main 已有 isComposing 守卫，PR #101 补强中，请报告者用最新版复测并补充按键序列 |
| #292 dsh-desktop 窗口按钮重叠 | 已回复 | 已定位到 aionui-floating-expand / collapse-chevron 在 WCO 模式下落到原生窗口按钮下方；留言给出 env(titlebar-area-*) 修法与验证要求（本机无 dsh-desktop） |
| #234 / #189 | 跟踪中 | 留言状态更新（#234 等抽屉侧根层渲染；#189 等报告者补充版本信息），保持打开 |

## 本机验证记录

- 8 个 PR review worktree（/tmp/dsh-triage-16e/pr-<N>）全部从最新 origin/main 检出
  并 rebase PR head；门禁按受影响面跑（typecheck + 受影响包 test + docs/community/
  skin-center/test:scripts/aggregate 相关项），全部结果见上表。合入前逐 PR 在
  rebase 后的 worktree 复验并通过后再 squash 合入，冲突按「保留双方」解决后
  将 head 回推作者分支（force-with-lease 校验旧 head）。
- #309 修复：skin-center 98/98（含 3 个新守卫测试）、skin-center:check 10 skins
  in sync；官方 design-platform.css light token 下 Playwright A/B 渲染——修复前
  仅滑块圆点可见、修复后轨道描边清晰可见。
- 环境：Node v25.8.1 + pnpm 11.9.0（CI 为 Node 22）。

## 遗留（下轮关注）

- #205 / #209 / #304 / #311 / #276 / #291 / #237 按本轮回帖补完后即可合入；
  #205 对应 #302、#304 对应 #290，合入后关闭对应 issue。
- #237 与 #293/#299 同追加 community.json 尾行，合入需在其最新 base 上重新生成
  community.ts（本机已预演 15 entries）。
- #298 归档视图整板宽与 1148px 以下横向滚动为实际行为，PR 描述与验收口径需在
  后续跟进中确认。
- #292 的 WCO 偏移修法需 Windows + dsh-desktop 实测证据。
- #234 等 biaoqingbao 抽屉侧根层渲染；#189 等报告者补充版本与层级信息。
