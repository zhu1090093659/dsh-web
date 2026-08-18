# 代码优化轮次记录：2026-08-17

一次性任务记录（归档）。流程：5 个只读审计子代理并行盘点候选（仅性能瓶颈 /
安全问题 / 代码冗余 / 可维护性，排除新功能与无谓重构），逐项在基于最新 main
的独立 git worktree 中实施，本地验证（包级 test + typecheck，必要时全仓门禁）
后 rebase 合并回 main。本轮共合并 47 项，拒绝 3 项，留待人工 1 项；期间 main
被其他会话/远程多次推进，每次合并前均 rebase 到最新 main，未发生冲突。

## 安全修复

| 提交 | 摘要 |
| --- | --- |
| 2de5f909 | ssh：删除/修改主机（host/port/user/auth/proxyJump）立即失效连接池与隧道，杜绝旧凭据已认证连接复用 |
| 03ecccd7 | ssh：上传字节上限按实际流计数（此前只查 content-length，chunked 可写满 staging 磁盘） |
| d7dd9d4a | aionui-panel：delete/rename 拒绝落在工作区根目录的拼写（'.'/'./'/'sub/..'，join 保留尾分隔符导致字符串比较漏判；relative() 兜底），防整个工作区被删 |
| 740fa287 | aionui-panel：拖拽载荷插入草稿前校验相对路径形状（外部页面可伪造自定义 MIME 注入文本） |
| e0b6fe2f | remote-web-ui：markdown safeUrl 拒绝协议相对 URL（//host 绕过协议白名单） |
| a6f82939 | community-plugins：安装命令的 repo/npm 字段拒绝 shell 元字符（生成器与运行时守卫双层） |

## 正确性 / 可维护性

| 提交 | 摘要 |
| --- | --- |
| 2997e77f | describe-image：修复 main 上预先失败的两个 thinking 后缀测试（mountOnce 守卫下单测试多 setup 空转，自 84e5c119 起红） |
| 89ae1d27 | ssh：stopTunnel 误杀同别名兄弟隧道的共享连接；顺带修复 startTunnel 无条件 acquire 造成的孤儿连接泄漏（TunnelRecord 追踪引用、按 record 共享判定、最后一个停止时释放） |
| 958a461b | ssh：withClient 重试循环无 catch 致预算成死代码——实现 README 承诺的断线重连（仅连接确实断开时重试，逻辑错误不重放）；exec 通道无退出码关闭时改为拒绝以触发重试 |
| 3d4ada1d | ssh：递归上传 walkLocalDir 改 lstat 跳过符号链接（链接环无限递归 / 链接目标字节误传） |
| 9459d9a3 | scripts：runtime-deps-check 门禁空转修复（lib 文件分组永远缺 package.json，实际扫描 0 文件；现扫 26 包并输出计数） |
| 60a02edc | live-stats：rebuild 先校验新 spec 再废弃旧投影（非法手改值不再导致投影消失） |
| 6eab2a45 | liangshen：Code Mode 展示的 latch 移到 tools 检查之后（缺失时不再永久跳过） |
| 22266677 | web-ui-settings：compat scope 订阅在插件卸载时释放（原永久泄漏到单例 store；顺带接通 BridgeScopeController.dispose） |
| 11809770 | task-board：normalizeTargetId 三处重复且 trim 语义不一致收敛为一处（未 trim 的空隙 id 会落库后失配） |
| 5161b3ad | git-graph：SSE 响应流挂 error 监听（断开竞态写入不再可能崩宿主） |
| c2d06506 / 16eb64fe | git-graph / aionui-panel：poll race 的 15s 超时句柄清理（每订阅者每 tick 泄漏一个定时器） |
| 2e638393 | describe-image：raw 路由 malformed percent-encoding 回 404（原抛 URIError） |
| 934a2931 | remote-web-ui：session.search 的 AbortController 接通 req 关闭（原创建即丢弃） |
| 34d0427e | remote-web-ui：RemoteEntry 不再在 setState updater 内铸 token（updater 可重入致双铸/旧二维码失效） |
| 81c499a6 | git-graph：GraphDialog load 加序号防乱序覆盖 |
| aa83cf48 | pet：state 轮询只应用最新响应（旧响应不再回滚快照） |
| 9587ee2d | remote-web-ui：配对限流 Map 惰性清理过期窗口（原随源 IP 无界增长） |
| f3b75f95 | scripts：release-notes 的前驱 tag 改祖先语义（原按版本号排序，hotfix/重打 tag 会产出错误范围） |

## 性能

| 提交 | 摘要 |
| --- | --- |
| f3105867 | ssh：HostStore 按 mtime+size 缓存解析结果（原每次 list/find 全量读盘解析） |
| 59c80f55 | task-board：永不匹配的 cron（如 2 月 30 日）repair 判定缓存（原每 tick 重扫 366 天逐分钟约 52.7 万次迭代） |
| ca06d92b | aionui-panel：attach 成功后断开全文档 MutationObserver |
| 9ecaa3b2 | aionui-panel：FsService.read 先 stat 后读，文本按 4 字节/字符预算有界读取（原整文件进内存再截断） |
| 45ca1659 | aionui-panel：applyGrid 缓存 details handle（拖拽每帧不再全树 querySelector） |
| 06ce48d8 | aionui-panel：SCM 行渲染 busy/failed/treeExpanded 转 Set（原每行 O(n) includes） |
| cfdfb2de | aionui-panel：preview 持久化的 LRU 淘汰加键数预检（原每次全量解析+排序） |
| 0c984678 | aionui-panel：preview fs 变更合并刷新（写风暴不再每事件全量 respawn git + 整文件读） |
| d05787ce | aionui-panel：discard 批量 git spawn（2N → 2，批量失败回退逐条保语义） |
| b0bdad21 | aionui-panel：TreeRow memo 自定义比较（原被 expanded 数组引用击穿整树重渲） |
| ee28ee3c | describe-image：语义缓存键改 sha256 摘要（原全量 base64 作键，32 条可钉住约 400MB） |
| a70c5912 | pet：精灵 row/track 计算提升到 effect 顶部（原每动画帧重复切片） |
| ac852bd1 | remote-web-ui：家族包 npm 探测并行化（原串行 N×10s） |
| bbba2c6a | remote-web-ui：移动端 bundle 每进程读盘一次（原每请求重读约 456KB） |
| f97e5ca7 | remote-web-ui：fold 结果有序时跳过重排序 |
| 896c9792 | git-graph：createBranch 存在性检查改单发 rev-parse（原列举排序全部分支） |
| aaa2354f | live-stats：未知块估值用预算递减 replacer 有界序列化（原全量 stringify 再截断） |
| 09ec4cb2 | web-ui-settings：bridge describe 每次请求只扫一次 seam |
| cecf7257 | community-plugins：插件过滤 memo 化（原每次渲染击穿下游两个 useMemo） |
| 0f7fccd0 | scripts：pr-review 复用模块级 emoji 正则 + diff 只解析一遍 |

## 冗余收敛 / 死代码

| 提交 | 摘要 |
| --- | --- |
| 56d0a013 | ssh：fastPut/fastGet 约 60 行重复合并为 fastTransfer |
| e7092fa8 | describe-image：readBoundedBody/readBoundedText 共用 drain 循环 |
| 189c3b8d | describe-image：loadImage 三分支的边界检查+嗅探收敛 finishLoad（本地文件分支顺带获得读后复核） |
| bb60b3cc | remote-web-ui：writeJson/readBoundedJson 收敛 http.ts（三处路由族复用） |
| f823db56 | pet：rowOfTrack 委托 state.rowOf（9 行动画行表单一事实源） |
| fcaaa1f5 | task-board：STATUS_KEY 收敛 board/status-key.ts |
| fca5735f | community-plugins：分类表由生成器输出 COMMUNITY_CATEGORIES，守卫直接引用（原三处可漂移） |
| 4e336bc9 | git-graph：status()/branches() 共享 snapshot() 管道 |
| a605ca1c | scripts：家族包遍历收敛 scripts/lib/family-packages.mjs（4 处脚本复用） |
| 857129f0 | scripts：sync-shared 设置三件套消费列表提取为常量 |
| f2bcadb1 | scripts：dsh-skin 注册表改从 skin.json 动态扫描（脚手架新皮肤即刻可切换；删除 BUNDLE_WIRED 死集） |
| 994af8a8 | liangshen：countWord 共享；删除无调用方且全量缓冲日志的 readEvents |
| 91cb7df6 | aionui-panel：删除恒空三元、toast 死定时器变量、4 个零引用导出 |
| fec19b80 | git-graph：删除未使用的 toast.createSuccess 语言键 |
| 75358d0f | web-ui-settings：删除未使用的 expand/collapse/empty 语言键 |
| 26d4b99b | remote-web-ui：删除 App.tsx 无人引用的 RenderMessage 副本 |
| e0480ac5 | scripts：dsh-skin-new 脚手架作用域修正为 @linxin666（原生成 @deepseek-ai 无法被链接/切换） |

## 拒绝的候选（附理由）

1. **task-board tick 单飞守卫**（scheduler-tick-awaits-execution 的残留部分）：其「tick 阻塞数
   小时」的核心论断证伪（exec.run 内 watchForSettlement 本就非阻塞）；重叠 tick 仅造成幂等
   重复 applySchedule。且任何同步安全的单飞实现都破坏 start() 立即 tick 的既有同步可观测
   语义（有测试锁定），收益不抵风险。
2. **web-ui-settings decode 异常防护**（unhandled-decode-rejection）：BridgeScopeController 的
   spec 永远不带 decode（compat-settings-scope.ts:332 只传 namespace），所述路径当前不可达。
3. **describe-image 缓存 set 前缀早退**（vision-cache-set-prefix-scan）：同键刷新会打破
   expiresAt 前缀有序性，早退会漏清过期项；且 Map 上限 32 条，全扫成本可忽略。

## 留待人工

- **remote-web-ui 消息折叠的完整增量改造**（mobile-fold-rebuild-per-chunk）：每流式 chunk 仍
  O(n) 重建索引（createState）；改为跨调用持久 FoldState 涉及 ChatView 历史加载/翻页的失效
  重建，属中型行为重构，建议单独评估。本轮已先合并「有序跳过重排」的部分收益（f97e5ca7）。

## 验证

- 每项在独立 worktree 内跑包级 test + typecheck（全绿才合并），合并前 rebase 最新 main。
- 收尾全仓门禁：typecheck / test / test:scripts / docs:check / aggregate:check /
  gallery:check / skin-center:check 全部通过。
- 全部 worktree 已删除，perf/* 任务分支已清理；轮次分支 perf/code-opt-round-2026-08-17。
