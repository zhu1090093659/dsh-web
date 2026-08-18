# 任务交接：功能请求集中处理轮（2026-08-17b）

> 本文件记录 2026-08-17b 功能请求集中处理轮的结果。执行原则：对 open 功能请求
> issue 做「现有功能增强 / 修复、UI 细节打磨」性价比筛选，高性价比的本轮实现；
> 每个功能基于最新 main 串行开发与验证（同一时间只处理一个功能请求），随后合并
> 进主线；合并前 rebase 到最新 origin/main，冲突保留双方更改并人工处理；同一时间
> 只允许一个合并者。执行分支：feat/feature-round-2026-08-17b（基于当时最新
> origin/main f57b766a，合并前随并行会话的推进两次 rebase 到最新 origin/main，
> 最终基线 3bcdb348，均无冲突）。开发与验证全程在隔离 worktree
> /private/tmp/dsh-feature-round-17/batch 进行，共享检出树未动。

## 本轮处理结果

| Issue | 结论 | 动作 |
| --- | --- | --- |
| #374 右侧浮动展开按钮支持上下拖动并记忆位置 | 已实现 | 浮动按钮支持按住上下拖动（pointer 拖动 + 3px 死区防误触 + touch-action: none），松开落盘 localStorage（aionui-floating-expand-top，范围校验，越界值回退居中）；默认位置改为「内容区垂直居中」（WCO 标题栏之下，见 #292）。commit 053b55a2（落盘修正 8b0a44f0） |
| #292 dsh-desktop 下右侧面板与窗口关闭按钮重叠 | 已实现 | 浮动按钮默认位置与拖动 clamp 均感知 navigator.windowControlsOverlay（visible + getTitlebarAreaRect + geometrychange 重定位），按钮不会落入原生窗口按钮区；配合 #374 可直接拖到中部/下部；Explorer 收起 chevron 的 env(titlebar-area-height) 偏移此前已在主线（#169 修复）。普通浏览器中 WCO 不可用则 offset 为 0，布局不变。commit 053b55a2（同 #374 一笔） |
| #315 Explorer / Preview 面板最大化与还原 | 已实现 | 两个面板标题栏各加「最大化/还原」按钮（可访问名称 + tooltip）；最大化后目标列接管整行（sidebar/details/聊天区/另一面板塌为 0px 轨，组件保持挂载不卸载，树/页签/展开/选中/滚动状态不丢）；Esc 或按钮还原（编辑类控件聚焦时 Esc 让位）；还原精确恢复宽度/折叠/布局；窄屏（<640px）改为 fixed inset-0 全屏覆盖（z 60，介于面板 chrome 与弹层之间）；maximized 为瞬态状态不持久化，切会话/workspace 由 layoutSetRoot 复位，不跨项目泄漏。commit 2da73c86 |
| #314 点击会话中的工作区文件引用在文件树中定位 | 已实现 | 文档级 click 委托识别转录中单行 code 里的工作区相对/绝对路径（含 Windows 分隔符与盘符大小写），点击后：切到「文件」页签、展开祖先链并选中、Explorer 折叠时自动展开；文件在 Preview 打开（去重聚焦已有页签），目录仅展开选中不预览；链接、多行围栏、URL、.. 越界、面板自身子树与未识别文本一律保持原行为，不发送越界文件请求。commit 40a6f0e5 |

## 未选中（回复说明、保持打开跟踪）

| Issue | 结论 |
| --- | --- |
| #363 remote-web-ui 隧道未就绪面板卡死 | 本轮由并行会话处理并已合入 origin/main（28f3553a，lan-required 也订阅 SSE、隧道 running 后自动重新 mint），本分支不重复处理 |
| #356 / #359 皮肤中心 DSH_SKINS_DIR 列表与打包版热切换 | 提示文案修正已由并行会话合入 origin/main（df60a749）；列表动态化与热切换（常驻皮肤模块 / host 触发 client modules rebuilt）改动较大，继续跟踪 |
| #307 全家桶彻底关闭右侧面板开关 | 与维护者路线冲突（即将启用 aionui-panel 并内置 better-sidebar），暂缓，保持打开 |
| #320 设置选项折叠到一个卡片 | 维护者已回复：现为刻意的一级分区设计，等作者补充期望的折叠形态后评估，保持打开 |
| #281 左侧对话列表收藏夹/星标 | 左侧会话列表属官方 shell 表面，插件层无对应槽位；需核心侧支持后插件跟进，保持打开跟踪上游 |
| #234 表情包抽屉被面板装饰覆盖 | 面板侧层级约定已定（列/装饰保持在列层之上，全屏抽屉须根层渲染 z 100~1000），修复落在 biaoqingbao 抽屉侧（portal 到 document.body），保持打开跟踪外部仓库 |
| #228 工作区内嵌套独立 git 仓 | SCM 单一 status 改多仓 map（约 200-400 行，中-高风险），本轮暂缓，保持打开 |
| #303 IME 改名闪退 | 依赖 PR #101（补强 isComposing 守卫）作者更新，保持打开 |
| #266 / #164 / #179(KaTeX) / #188 / #279 / #212(剩余) / #128 | 维持此前轮次结论（核心侧支持 / 上游跟踪 / 大改暂缓），状态不变 |

## 本机验证记录

- 隔离 worktree /private/tmp/dsh-feature-round-17/batch（基于 origin/main
  f57b766a；合并前随并行会话推进两次 rebase，最终基线 3bcdb348，无冲突）：
  pnpm install --frozen-lockfile --ignore-scripts 后按受影响面包级门禁。
- 包级增量：aionui-panel 210→266 用例（floating 几何与 WCO 12 个、maximize
  纯逻辑与 store 转移 9 个、file-ref 识别与定位 22 个、层级契约 CSS 2 个、
  layout controller DOM 集成 11 个——最大化接管轨/overlay 类/Esc 让位/拖动
  clamp 与落盘/点击抑制/位置恢复），全绿；typecheck、build（client bundle
  248.78 kB / gzip 57.82 kB，与基线一致级别）通过。
- 全仓门禁：pnpm typecheck、pnpm test:scripts、pnpm docs:check、
  pnpm aggregate:check、pnpm skin-center:check、pnpm gallery:check、
  pnpm community:check 全绿。
- WCO / Windows 桌面端无法在本机实测：titlebarAreaHeight 经 jsdom mock
  （visible / rect / 异常路径）覆盖，env() 在普通浏览器为 0 不影响布局；
  #292 已在 issue 回复中请作者在 Windows 复测。
- 环境：Node + pnpm 11.9.0（CI 为 Node 22）。

## 遗留（下轮关注）

- #315 最大化期间面板拥有整行、shell 写 grid 时最大化覆盖写回；还原后 shell 轨
  以最近一次 shell 写为准，如需进一步打磨互操作可后续跟进。
- #314 目录目标暂只对带斜杠或盘符的路径识别（单段目录名不触发，防误触），
  如需可后续加 host stat 路由做更精确的目录识别。
- 并行会话的 #356 / #363 已合入 origin/main；本地 main 的 pet 系列 4 笔未推送
  提交仍由对应会话负责同步推送。
