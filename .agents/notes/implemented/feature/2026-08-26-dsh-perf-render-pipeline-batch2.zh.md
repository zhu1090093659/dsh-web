# Agent Note：dsh-perf 渲染管线第二批（settle 翻转队列、加权 heavy 判定、列表发布门控、流式转发冷却）

状态：implemented

承接 [dsh-perf 渲染 shadow 重做](../bug-fix/2026-08-26-dsh-perf-render-shadow-rework.md)。

## 问题

对官方 DOM 渲染管线的三分区 bundle 审计（会话区 / renderer+frontend markdown / 运行时+侧栏，全部证据带 lib 文件行号）产出四个插件可达发现，按用户可感知影响排序：

1. **settle 翻转突发（来自我们自己的 shadow）**：保持观感的 shadow 给每条 heavy 消息独立 600ms 定时器，会话打开/多步回合结束时 N 条 heavy 消息同帧翻转——单帧同步突发 N x（全量 markdown 解析 + 每围栏 shiki codeToHtml + 每公式 KaTeX renderToString + innerHTML 解析）。官方管线没有任何错峰机制（全 bundle 无 requestIdleCallback/scheduler.postTask）。
2. **heavy 判定盲区**：blockChars 只数纯文本字符。「12 个代码围栏 x 400 行约 15k 字符」低于 20k 阈值，但聊天代码块无行数上限（对比 ReadBlock/DiffBlock/TerminalBlock 的 16 行封顶），其 settle 突发与巨型消息同样重。助手 data.blocks 只有 text/reasoning/tool-call 三种，围栏是 text 块内的 markdown 源码。
3. **侧栏列表发布浪费**：projectList（dsh-client-runtime L9216-9284）每次 manager flush 把 {ids, byId, current, phase, subagentsByParent, jobsBySession, currentAddress} 全量重建为新对象，而树组件用 useSessions((s) => s) 订阅（workspace lib L1201/L1471/L1589，无相等函数）。流式期间 flush 主体是 usage/token 投影帧——只有 byId[].projectionValues 身份变化，侧栏可见字段零变化，整树照渲染。本账号实测（1704 会话）：30 秒内 30 次此类无效发布。
4. **巨型单节点流式重解析 O(n^2)**：官方增量解析器冻结已完成顶层节点，但开放式巨型围栏/无空行长段落把 tailStart 钉在 0，且 DeepSeek 宿主适配器把整个回答作为一个 text block 流出。块级 memo/尾窗渲染必须进入官方渲染器（拆块会破坏间距：p{margin:16px 0} + gap:16px 会把 16px 变 48px）——确认在插件范围外。

## 决定

- **#1 settle 翻转串行队列**（perf-flip-queue.ts）：模块级 FIFO。入队保留原 600ms 最小延迟（eligibleAt）；队列每 intervalMs（默认 120，dsh-perf-flip-interval）只翻转一条。把 N 条同帧突发摊成 N 帧。外观逐像素一致，只改翻转时机。
- **#2 加权 heavy 判定**（perf-heaviness.ts）：scoreBlocks = 文本字符 + 围栏字符 x1 额外（正则 /```[\s\S]*?(```|$)/g）+ 公式数 x 1000（O(n) 定界符扫描 $$ / \[，规避回溯失控）+ reasoning x 0.2 + tool-call argsRaw x 0.25。
- **#4 会话列表发布门控**（perf-list-gate.ts）：对 sessions.list.set 做方法级补丁（store 对象共享，官方 this.list.set 调用点自动走门）。每次发布前与当前已发布快照做侧栏可见字段比对（条目除 projectionValues 身份外的全部字段、ids 顺序、current、phase、currentAddress、subagentsByParent/jobsBySession 内容）。可见变化立即发布（带走最新投影）；仅投影身份变化合并到约 1s 尾部补发（dsh-perf-list-coalesce，默认 1000ms）。唯一可感知代价：子代理 lineage 头部 token 计数从每 usage 帧降到约 1Hz 刷新。dispose 恢复原 set 并补发挂起快照。实测：30 秒 30 次无效整树重渲染降为 3 次尾部补发。
- **侧栏会话行降载 CSS**：dsh-better-sidebar（第三方，渲染侧栏）展开大分组时一次性挂载全部行（395 行 ≈ 4-7k DOM 节点，其 642KB bundle 中 0 个 React.memo），并持有 #root 的 childList+subtree MutationObserver。dsh-perf 降载样式表现对侧栏会话行同样施加 content-visibility:auto + contain-intrinsic-size 32px（_sidebarCol 下的 _sessionRow 子串选择器，上游改类名则自然失效）。上游 issue：https://github.com/omdsh-dev/DSH-better-sidebar/issues/403。该规则已在[移除 dsh-perf 侧栏会话行降载 CSS](../../simplification/2026-08-28-dsh-perf-sidebar-row-degrade-css-removal.zh.md)中删除：固定 32px 占位行高把行钉在固定位置、干扰 dsh-better-sidebar 自身布局，降载样式表收回消息行本身。同一轮审计还发现 @omdsh-dev/dsh-annotation 每秒全文档扫描（decorateAll：querySelectorAll('[data-chat-flow-kind]') + 每行子树查询 + textContent 读取），成本随上下文长度线性增长，暂未上报上游。
- **#5 流式转发冷却**（perf-assistant-shadow.tsx 内，dsh-perf-stream-cooldown 毫秒，默认 0=关）：流式期间冷却窗口内向官方转交上一次 node 引用，官方 memo(assistant-step) 整帧跳过；尾部定时器保底追平。文本以更粗粒度跳动——可见差异，故默认关闭。
- **#3 ConversationRoot 整壳每帧重渲染——不实现，仅上游建议。** 插件各层均被堵死（有证据）：三个外壳槽（conversation.session / conversation.session.header / conversation.composer.bar）是 kind:"single"，winner 条目自带 store + inject（kit 由胜注册构建，见 renderer standardKit/cachedSessionInject），而官方注册的 inject 闭包捕获包内私有状态（inputHub、submissionPolicy、views），shadow 无法提供等价 props。store 层同样无解：zustand 只在身份变化时通知，而聊天 seat 需要每帧通知，外壳快照身份必须变。正确修法在上游：ConversationRoot 改字段级 selector（conversation lib L7155-7162 的 useSession((s) => s) + useInput((s) => s) + useWorkspaces((s) => s)）并 memo 化 InputBar。

## 上游建议（记录，不实现）

- subagent.history / session.history 响应是未压缩原始事件流：打开一个子代理会话拉取 12.3MB / 65,844 事件，实际推理内容仅约 188k 字符（reasoning-delta/tool-call-delta 逐 chunk 放大 65 倍）；maxMessages 按 message 数分页，49 条消息的会话就是一个整页。建议启用 gzip、提供 projection-first 加载路径、重新考虑 chunk 级分页。
- ConversationRoot 整对象订阅（同上）。
- 全局语言加载重高亮风暴：shiki 语言代数 Wu 在每个 CodeBlock 的 memo deps 里，任一新语言加载成功会重高亮页面全部代码块。
- KaTeX 无缓存：相同公式跨消息重复 renderToString + DOMParser。
- locations.touch 每 chunk O(turn)；滚动容器在底部时每帧一次强制布局。
- 官方树中不存在 mermaid 渲染器（早前假设有误）。

## 影响

- 新增 localStorage 旋钮（均为可选调试向）：dsh-perf-flip-interval（120）、dsh-perf-list-coalesce（1000）、dsh-perf-stream-cooldown（0）、dsh-perf-debug（1 时暴露 window.__dshPerfListGate 计数与翻转日志）。
- 列表门控跟随总开关 + renderDegrade；对 HMR 双装幂等，dispose 恢复原 set。
- 风险观察：门控补丁作用于非公开 store 形状（sessions.list）；上游若改名，安装时 warn 并跳过（失败开放）。

## 验证

- pnpm --filter @linxin666/dsh-perf test：28/28（heaviness 8、flip-queue 4、list-gate 10、integrity 6）；typecheck 与 build 通过；pnpm docs:check 通过。
- 真实 127.0.0.1:3080 GUI headless CDP：翻转队列调试日志显示 4 条 heavy 消息入队后逐条翻转、全程零 >50ms longtask（此前为单次约 200ms 突发）；流式期间列表门控计数 30 秒 10 次立即发布 / 30 次合并 / 3 次尾部补发；翻转后代码高亮 span 存在（无消息卡在未高亮态）。
- 受阻项：并发会话于 10:32 改动 ~/.dsh/profiles/web/package.json 导致 web boot 失败（dsh-client-ui-subagent 等待无任何活动插件提供的 slash 服务），侧栏的整 GUI 视觉验证推迟；门控机制由单测与实时计数覆盖。
