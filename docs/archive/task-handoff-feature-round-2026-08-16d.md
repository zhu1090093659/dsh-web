# 任务交接：功能请求集中处理轮（2026-08-16d）

> 本文件记录 2026-08-16d 功能请求集中处理轮的结果。执行原则：对 open 功能请求
> issue 按「兼容性 / 低代码可维护性 / 插件运行时性能与效率」做性价比筛选，高性价比
> 的在本轮实现（远程先行实现与已合并实现也一并核验收口），每个功能在独立 worktree
> 中开发与验证，随后合并进主线。执行分支：feat/feature-round-2026-08-16d
> （基于 origin/main 986845af，v0.1.17）。

## 本轮处理结果

| Issue | 结论 | 动作 |
| --- | --- | --- |
| #256 任务看板任务级执行目标（工作区/模式/权限） | 已合并（先行） | PR #257 已由贡献者实现并合并（ea6dc60e，v0.1.17）；本轮本地核验 task-board 153/153 全绿，issue 关闭 |
| #178 移动端上下文用量百分比 | 已实现 | dsh-remote-web-ui 移动端：fold 追踪 request/context 与 assistant/message usage，工具栏「上下文 N%」芯片，>=80% 警示色；commit b3801b2d，包测 192/192 |
| #176 移动端显示选项（工具调用 / 系统提示词开关） | 已实现 | 移动端「显示」底栏面板，localStorage 持久化；注入消息（source.kind != user）默认隐藏，工具调用默认显示；commit b3801b2d |
| #241 右侧面板代码预览语法高亮 | 已实现 | 复用官方 SDK 内置 shiki core（CodeBlock，平台模块外部化，bundle 零增长），主题色走官方 --shiki-* 变量，未知扩展名回退纯文本；commit 4127a830，包测 163/163 |
| #80 对话框背景高斯模糊（空对话 / 有对话分档） | 已实现 | 皮肤中心新增两个 0-20px 模糊档位，body 固定 backdrop-filter 层 + MutationObserver 按对话内容切换，0 时不创建元素（无 GPU 开销）；commit 4a8685af，包测 91/91 |
| #238 dsh-deepread 收录 | 已收录 | 社区索引登记（npm 0.5.3 / MIT / 仓库在线），commit 3a86c2dc，issue 关闭 |
| #173 dsh-mnemon 收录 | 已收录 | 社区索引登记（npm 0.1.4 / MIT / 仓库在线），commit 3a86c2dc，issue 关闭 |

## 未选中（回复说明、保持打开跟踪）

| Issue | 结论 |
| --- | --- |
| #255 mermaid 渲染 | 暂缓：新插件 + 7MB/3.5MB vendor 与性能预算冲突；PR #270 继续跟踪 |
| #212 会话删除 / 智能委派 / 文件树右键菜单 | 暂缓：两个新插件 + host spawn 路由需安全与维护成本评审，建议拆分 |
| #197 自定义背景（图片/URL/纯色/渐变） | 暂缓（本轮落地 #80 模糊部分）；上传路由与半透明面板留待后续 |
| #194 技能中心 Skill Explorer | 方向可行，但插件尚未发布 npm；请先发布再按规范提 PR |
| #188 文件拖拽上传 + 文字引用 | 暂缓：上传通道与引用选择落在核心 composer 区域，需上游配合 |
| #179 移动端 Markdown + KaTeX | 暂缓：bundle 455KB->1.1MB 与性能预算冲突；建议先拆 GFM-only PR |
| #128 本地终端 | 暂缓（新插件级功能，维持此前结论） |
| #125 台账 host 化 + 归档 + Agent 入口 | P1 工作区绑定已随 #256/#257 落地；其余部分继续跟踪 |
| #85 免构建皮肤目录 | 暂缓：目录扫描 + 路径安全属于较大特性 |
| #266 梁神模式双分支 | 维持上轮结论（预设升级参考，保持打开） |

## 本机验证记录

- 四个功能分别在独立 worktree（/tmp/dsh-web-ui-fr-mobile / -highlight / -blur /
  -community）开发并各自跑包级测试；合并后在 /tmp/dsh-web-ui-fr-verify 全量复验
  （typecheck / test / test:scripts / docs:check / aggregate:check / gallery:check /
  skin-center:check / community:check / runtime-deps:check / emoji 扫描）。
- 实时 GUI 抽查：皮肤中心新模糊滑块、aionui 代码预览高亮、移动端 bundle 与社区
  插件列表（浏览器实测，见浏览器控制台与 bundle 检查证据）。
- 环境：Node + pnpm（CI 为 Node 22）。

## 遗留（下轮关注）

- #255 的 PR #270（mermaid）仍在远程 PR 轮跟踪。
- #234 / #189 / #164 等 bug/上游类 issue 不属于本轮功能请求范围，状态不变。
