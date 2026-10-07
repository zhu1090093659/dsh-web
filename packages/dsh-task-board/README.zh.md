# dsh-task-board · DeepSeek Harness (DSH) 自动化任务看板与 Cron 定时调度插件

[English](README.md) | 中文

<p align="center">
  <img src="https://img.shields.io/npm/v/@linxin666/dsh-task-board?style=flat-square" alt="Version">
  &nbsp;
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.0--rc.2-4c6ef5?style=flat-square&amp;labelColor=454a54" alt="DSH">
  &nbsp;
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>DeepSeek Harness（DSH）官方 Web GUI 与桌面客户端自动化任务管理与长程后台执行引擎</strong><br>
  <em>5 列状态流转 · Cron 后台定时调度 · 智能体真实执行 · 防休眠电源保护 · 任务验收质检</em>
</p>

一个高可用、可热插拔的 DeepSeek Harness (DSH) Web GUI 与官方桌面客户端任务自动化插件，提供 Host 权威任务账本、真实 DSH 会话自动化执行、Cron 表达式后台定时调度、跨平台空闲睡眠保护、多 Agent 团队级联与自动化质量验收门禁。用户无需常驻浏览器，即可在后台无人值守运行代码巡检、健康检查与定时自动化流水线。插件只通过 `cordis.patch.yml` 与 profile 机制挂载，零修改侵入 DSH 官方源码。

- 浏览器只是异步视图；关闭页面不会停止 Host 调度或执行结算。
- 每次运行在发送任务 Prompt 前应用钉住的工作区、agent 预设与权限；默认每次新建独立 DSH 会话，任务也可选择改为在上一会话中继续（issue #1419）。
- 默认每次运行都会武装 dsh 内置的 `/goal`：会话自动续跑多轮直到目标完成，看板在该目标真正结束后才结算本次执行；每个任务都可以关闭该选项。
- 可选电源保护允许显示器熄灭，同时阻止整机因空闲进入系统睡眠。

## 功能

卡片保留多行标题、描述预览及可见的元数据。预览去除 Markdown 标记，详情中的描述与 Prompt 按安全 Markdown 渲染，不执行原始 HTML 或自动加载远程图片；超过约八行的内容默认按固定高度钳制并带渐隐提示，点「展开全文」展开、可再收起，未超出的内容原样渲染且无切换按钮。任务原文保持不变。标题开头的方括号前缀（如 `[Bug]:`）渲染为类型徽章，描述预览跳过 Issue 表单的模板内容（勾选列表、小节标题、空字段占位），存在摘要类小节时优先取它。卡片左侧色条显示最近一次执行（运行中、成功、失败、取消）；所在列与该次执行不一致的卡片标注为手动结算。每列显示能区分卡片的时间——待规划/待办为创建时间、运行中为开始时间、已完成/已失败为结算时间——按 Host 时区读取。最近一次执行的会话可直接从卡片打开。每个列头都可切换紧凑单行卡片（已完成列默认紧凑，选择保存在浏览器中）；已完成、已失败与归档按「今天 / 近 7 天 / 更早」分组，列内超过 30 张卡时折叠最早一组，搜索时不折叠。

- **任务看板 UI**：看板是 shell 自己的中栏面板——它像桌面版【插件】页那样，向 shell 的官方侧栏面板列表贡献一行、向布局的中栏座位贡献一页，因此行的几何、选中高亮、折叠 rail、标签与语言切换都由 shell 统一负责；看板提供五列布局、搜索、任务详情、归档/恢复、执行历史和执行会话跳转。五列都可以手工切换：拖拽卡片或在详情页点状态即可，只写列、不产生执行记录——「已完成」「已失败」声明工作在受追踪的执行之外结束（或失败），「进行中」则表示工作正在进行但没有对应会话；真正在执行中的卡片在结算前拒绝任何移动。归档任务除恢复、删除和查看 transcript 外保持只读，恢复前不能手动或定时执行。
- **续接卡片（数据面）**：新建任务时可粘贴会话输出的 `<<<FREEZE … >>>FREEZE` 冻结块，解析为「目标/进度/下一步」快照随任务持久化（v3 账本）；卡片带冻结徽标，详情页可读完整快照与冻结时间，搜索覆盖快照文本，归档/恢复与普通任务一致。快照在协议层复用冻结安全门：敏感模式自动替换为 `[REDACTED]` 并标记、以 `/` 开头的命令行整体拒绝、每字段 8 KiB 上限。
- **交接包与权限确认门**：续接卡片可附交接包——钉住三元组（工作区/agent 预设/权限）加文档与脚本引用。执行时交接包三元组覆盖普通钉住字段，引用以交接前言随 Prompt 下发。有效权限高于部署权限基线——未钉住 `sessionDefaultPermission` 时即宿主自己的默认权限预设——的绑定处于待确认状态：手动执行被拒绝、cron 跳过该卡并滚动到下一触发点，任务详情中的确认按钮完成人工确认；此后任何权限或交接包变更都会重新武装确认门。
- **领卡来源声明包裹与来源审计**：执行续接卡片（带冻结快照的卡片）时，任务指令被来源声明模板强制包裹——冻结时间、来源会话与未经人工审查提示，组合在交接前言之后，使接手 Agent 对卡片文本中的存储型提示注入保持警惕。create/update 动作的发起方会话织入快照（frozenBy，快照被替换时重新盖章），run/rerun 的发起方会话连同冻结来源的捕获副本一起落在执行记录（initiatedBy）上，两者均可在任务详情查看。发起方为客户端断言的审计元数据，不构成信任边界。
- **任务标签（issue #1521）**：每个任务可带最多八个标签。标签在卡片上渲染为带色调的徽章——色调由标签名哈希得到，因此同一标签永远同色，也不需要存储颜色；看板顶栏据此提供多选标签筛选，候选项来自全账本在用的标签（含已归档任务），搜索也会匹配标签名。填了「执行提示」的标签会在每次执行前以 `标签提示` 段注入到执行 Prompt 之前；没填的标签只作展示与筛选，因此无标签任务的 Prompt 与加入该功能前逐字节一致。标签在首次执行后仍可编辑：它们给任务分类、塑造下一次运行，而不是「已经跑过什么」的凭证。筛选行的**管理标签**入口会打开标签管理器：列出每个在用标签及其任务数，重命名会写到所有卡片上（与已有同名标签合并，并保留该标签的执行提示），删除会从全部任务（含已归档）上移除。两者都是 Host 的整账本事务，因此多个窗口看同一块看板时状态一致。
- **子任务与级联执行**：任务可以有子任务——在详情页新建子任务（表单以父任务的工作区、模式、权限和模型为起点，每一项都可覆盖），或把一个还没有父任务的现有任务关联为子任务；子任务不在运行中时也可以解除关联。父子关系的准入由 Host 判定：父任务必须存在且在看板上、任务不能挂到自己的后代之下、树的深度不得超过配置的 `maxSubtaskDepth`（默认 1 层，最大 3 层）。执行一个任务会并发执行它整棵子任务树——每个成员各开一个 DSH 会话，同属一个 run group——父任务卡片会一直留在「进行中」列，直到它自己的回合与全部子任务都结算；任一成员失败则父任务判为失败，而单个子任务失败不会阻塞其它子任务。看板会标注父任务与子任务卡片，详情页列出直接子任务，顶栏提供一键隐藏子任务。
- **Agent Team 执行（任务级 opt-in）**：任务可在详情页（或经 `task_board_create`/`task_board_update`）开启团队执行。执行这样的任务只启动一个会话——Team Lead——随后 Host 通过 Agent Teams 服务在它内部为每个子任务派生一个 teammate，并把 teammate 的会话挂到该子任务的 execution 上。整棵子树被压平成这一个 Team（只有 Lead 可以派生）；Lead 的提示词按名字列出每个 teammate 并指向团队工具，团队执行由 Lead 判定统辖：teammate 自己已完成的回合即结算它的卡片（即使 Team 仍让该会话存活），Lead 自身结果落定后，仍未报结果的成员一并按该判定结算。普通级联的提示词结构相同，只是改为列出各独立会话。该模式依赖可选的 `agentTeams` 服务：未提供该服务的部署会明确拒绝执行而不是静默降级；子任务自己的权限钉住若高于 Lead 会话实际权限也会被拒绝，因为 teammate 继承 Lead 会话的权限且无法被收窄；Lead 已覆盖的钉住则让该成员按 Lead 的权限照常执行，而不是让整次运行失败。团队执行总是新建 Lead 会话（同一 Team 内 teammate 名字不可变），并使用 `teamProvider`。会话历史完全读不到的 execution 会在轮询满两分钟后带原因判为失败，因此读不到历史的会话不会把卡片永久留在运行列。
- **项目分区（issue #1536）**：看板头部新增项目下拉，选项来自当前部署的 DSH 工作区——「全部项目」加每个已注册项目。选定项目后各列只显示钉在该项目上的任务，未钉工作区的任务只在「全部项目」下可见；在某个项目下打开「新建任务」会把该项目预选为任务工作区，「新建项目…」则用与 GUI「添加项目」相同的运行时接口把宿主目录注册为项目。未选项目而创建的根任务——无论来自表单还是看板的 agent 工具——继承创建它的会话所在的工作区；仍未钉住工作区的卡片在部署最近使用的工作区里执行，而不是落到宿主自身的工作目录。
- **粘贴文本 AI 解析（issue #1540）**：新建任务表单可以把从别处复制的一段话交给模型，整理成标题、描述和执行 Prompt。模型取当前部署已配置的模型（与任务「模型」下拉同一份列表，默认选中第一项），调用在宿主侧完成，走看板既有的回环与同源校验，预算 45 秒并支持取消。解析结果只填进表单：不提交就不会创建任务，解析失败也不会改动你已经输入的内容。
- **可折叠的任务表单**：新建/复制/子任务对话框把配置分成可折叠区域——任务内容默认展开，其后依次是标签、执行设置、运行方式、交接与续跑、定时运行——每个折叠区域都保留一行当前值摘要，因此对话框不需要滚动条（正文仍保留极矮窗口下的溢出兜底）。Agent 预设字段更名为「Agent 预设」，把部署内置预设以本地化名称列出，并附上任何用户预设；默认的「继承」选项会写明未钉住时真正使用的预设。
- **Host 权威账本**：任务、计划和执行记录存于 `$DSH_HOME/task-board/ledger-v2.json`；浏览器动作只有经 Host 确认后才成为 UI 状态。
- **有界执行历史**：每个任务只保留最近 20 条执行记录；新运行开始时截掉最旧的记录，使账本大小与每次写入成本不随任务历史无限增长。
- **真实执行**：手动运行和定时运行共用 Host runner，默认新建独立会话、重命名、应用 agent 预设和 `/permission <id>`，再以 queue 模式发送任务 Prompt。
- **目标驱动执行（默认开启）**：除非卡片在详情页取消勾选（新建任务对话框默认勾选），runner 会先入队任务 Prompt，再以同一份组合 Prompt 作为目标武装 dsh 内置的 `/goal`。dsh 的目标轮次驱动器会在同一会话中不断开启续跑轮次，直到 agent 标记目标完成；看板则让该执行一直保持 `running`，直到目标离开 active 阶段：目标正常完成判为成功，被阻塞则以目标自身的原因判为失败。该选项按任务设置（`goalRun`，缺席即开启），`task_board_create`/`task_board_update` 同样可用。
- **任务验收（默认开启）**：以 goal 形式执行的任务必须先通过一次验收，`update_goal(action: complete)` 才会生效——看板在官方「工具执行前」生命周期上拦截这次调用，而不是相信 agent 的自述。验收沿用已安装 dsh-llm-verifier（MIT）的默认最终验收：三项 coding 判据（Specification Adherence、Output Match、Error Signal Detection）、总分与每项判据都必须达到 0.65 阈值、每项两轮并交换 A/B 位置后取平均、以任务真实轨迹（工具调用及其输出、assistant 文本）对比空工作基线，实际工作必须胜过该基线；部署记录工作区变更时，还会附上宿主自身对「本次运行改了磁盘上什么」的记录（文件清单与增删行数、有界的逐文件对比）作为提示词的参考上下文，使「只在自述里写过的补丁」无法通过。同一 execution 最多验收两次：第一次不通过把总分、逐项分数与可定位问题交回修复的 agent，第二次仍不通过即判该 execution 失败。额度记录在 execution 记录上，因此重复完成调用、跨入下一 goal 轮次、插件重载与宿主重启都复用同一周期；重跑或一次定时触发则是新的 execution、重新计数。验收异常（超时、鉴权失败、裁判回答无法解析、裁判路由不可解析）与质量判定分开记录，不消耗质量额度。异常额度用尽并不把卡片判死：裁判路由答不上来是环境故障而不是工作不合格，此时执行周期保持打开、不再发起裁判调用，直到用户通过 `task_board_manage(action: reset-verification)` 清除已记录的异常。若一次验收在产生任何判定前就耗尽时间预算，会单独记为一类结果，不消耗任何额度，同样不判死卡片。两个上限都是配置项（`goalVerificationCallTimeoutSeconds`、`goalVerificationBudgetSeconds`），按需实时读取；剩余时间装不下一次调用时不会发起这次注定被中断的调用。运行列显示「执行中 / 验收中 / 验收未通过修复中」，每条 execution 记录展示判定、裁判模型与强度、次数、各项分数与阈值、问题反馈、证据范围与 token 用量。强制验收还堵住了旧回退路径：暂停的 goal、读取失败的 projection、已完成的回合与人工强制结算，都不能在没有匹配通过记录的情况下把 goal 执行结算为成功。带着验收记录失败意味着裁判给出了判定而工作没通过；一条验收记录都没有的失败则单独说明：验收门从未打开，因为执行会话没有调用 `update_goal(action= complete)`（常见于只在回复里宣告完成），交付从未被判定，更谈不上被判负。**单张卡片可以退出这道门**：新建任务与任务详情都有「跳过本任务的验收」勾选（默认不勾，语义与「同一对话继续」「以 /goal 开始执行任务」同级的卡片级选项），勾选后该卡以 goal 形式执行时不再拦截完成声明，执行记录标注 `applicability: skipped` 并在验收面板写明「该任务卡勾选了跳过验收」——它与总开关关闭是两回事，看板会分别说明。只对之后新开的执行生效，运行中改勾选不会改写已在飞的执行的判定规则。
- **可选会话复用**：任务可选择在上一执行会话中继续（issue #1419）。仅当该会话空闲且仍在运行时会话名册中才复用——Host 会重新应用钉住的权限与模型再以 queue 模式发送 Prompt，会话标题与历史保持不变；否则照旧新建会话，因此名册未知或会话正忙都不会阻塞定时运行。名册读取就发生在这次启动本身，所以长期空闲的看板会复用一个一直空闲的会话，而不是因为缓存过期而拒绝它。
- **空闲时停止会话轮询（issue #1821）**：只有当看板确实有需要名册裁决的事情时，Host 才读取 DSH 会话名册——存在待核对的执行，或运行列里有一张卡片（它的结果可能来自本进程没观测到的结算）。空看板、没有运行中卡片、没有未结算执行、也没有已启用计划时不轮询任何东西，因此空闲的 Host 不再按固定心跳重建每一条持久化会话行（字符串转换、对象分配、每条记录一次 stat）。有工作时按配置项 `sessionPollSeconds` 的节奏轮询；读取失败或名册仍未知时按翻倍延迟退避，上限一分钟，因此会话树故障时不会被按轮询间隔反复冲击。
- **钉子失败即关闭**：工作区缺失、预设缺失或损坏、权限命令被拒绝时，任务 Prompt 不会发送。
- **Host 调度器**：5 段 cron 支持 `*`、`*/n`、范围、逗号列表和周日 `0/7`。每条规则携带自己的 IANA 时区（默认跟随 Host 时区），日期/星期遵循 Vixie 语义：两个字段都受限时为 OR，其余组合为 AND。夏令时切换处的墙上时间空洞会被跳过，重复出现的歧义时刻只触发一次并取更早者。
- **确定性恢复**：已有 session id 的 running execution 在重启后继续观察；没有 session id 的启动中断会取消且不会重发。
- **实时同步**：变更返回完整 revision snapshot；SSE 只提示 revision、scheduler 与 power 变化，重连和页面恢复可见时重新拉完整 snapshot。
- **可选空闲睡眠保护**：默认关闭；开启后覆盖全部运行中的 DSH 会话、已启用且未归档的任务计划和未知会话状态。
- **系统提示词注入**：Host 通过 `SystemPrompt.section` 注册 order 200 的 `plugin:task-board` 段；任务看板设置可单独关闭声明而不关闭看板。该提示也会提醒 agent 在最终回复前收尾可见的 `todo_write` 计划列表。
- **Agent 工具**：每个会话都可使用八个面向模型的工具（`task_board_list`、`task_board_get`、`task_board_create`、`task_board_update`、`task_board_set_parent`、`task_board_run`、`task_board_manage`、`task_board_schedule`），它们驱动与浏览器完全相同的 Host 账本，因此 agent 可以在对话里列出看板、创建子任务、关联或解除关联、执行级联、把卡片移到任意列（含不经执行直接声明完成、失败或进行中）、归档/恢复/删除卡片、对看板已无法观察的卡片强制结算，以及为卡片配置 cron 计划。
- **Host 之外完成的执行结果（issue #1826）**：不由本 Host 执行的工作——例如在 DSH 之外用各自模型工作的 Codex、Claude Code——可以登记成一次真实执行，而不是只改一列。`task_board_manage(action: 'record-external-outcome', result: 'succeeded'|'failed', initiatedBy: <完成者>)` 会追加一条 execution 记录，带上判定、完成者与可选摘要；终态列由这条记录推导，与 Host 结算走同一条规则（`core/tasks.ts` 的 `settledStatus`）。该记录带 `external` 标记、永远不带 session，并在卡片仍有未结算 execution 时被拒绝（本 Host 正在执行时它才是唯一权威），归档卡片同样拒绝。`running` 与 `cancelled` 不能这样登记：它们只属于 Host。手工 `move-done`/`move-failed` 仍然可用，也仍然只写列——区别在于这一条会留下记录，因此列与执行历史永远不会脱节。

- **外部提供方扩展**：GitHub Issues 扩展（`@linxin666/dsh-client-ui-task-board-github`，默认开启）把 GitHub Issues 同步成看板卡片。它是本看板的提供方，因此其配置渲染在本插件自己的设置卡里——仅当扩展已安装时该区块才出现，且只有扩展开启时才显示仓库与凭据表单；见[扩展包 README](../dsh-task-board-github/README.zh.md)。

## 架构与协议

看板视图在首次打开时渲染，关闭后重新打开会保留本地视图状态。Host 同步、调度和执行独立于视图持续运行。

- `src/index.ts` 通过官方 `@deepseek-ai/dsh-api-gateway`、`@deepseek-ai/dsh-workspace` 与 `@deepseek-ai/dsh-host-webserver` SDK 挂载 Host 服务。
- `src/host-ledger.ts` 串行动作，并用临时文件加原子 rename 持久化 `{ schemaVersion: 3, revision, tasks, scheduler, recentRequests }`。
- `src/host-service.ts` 负责 cron 触发武装（按账本最近的到期时刻武装一次性定时器，宿主未提供 `timer` 服务时回退到进程定时器）、错过触发跳过、runner 启动、重启对账和电源保护理由。
- `src/client/native-panel.tsx` 注册看板的侧栏行与中栏页面（官方 `sidebar.panellist` 列表座位与 keyed `main` 座位），并维护与 ssh 面板的中栏互斥协议。
- `src/client/host-api.ts` 单次导入旧浏览器数据、提交幂等动作，并把 Host snapshot 当作唯一已确认 UI 状态。
- 同源接口为 `GET /api/task-board/state`、`GET /api/task-board/events` 和 `POST /api/task-board/action`。
- 所有接口都要求浏览器同源标记：`sec-fetch-site: same-origin`、`Origin` 头，或 Host 的 `dsh-auth-*` 浏览器认证 cookie。最后一种是 DSH 桌面版到达看板的方式：它从 `dsh-app://app/` 提供 Web GUI，并自行转发该页面的请求，转发时删掉 `Origin` 与 `sec-fetch-site`，改为附上启动时用 Host 启动链接换来的、与 authority 绑定的 cookie。直接访问只允许 DSH loopback origin；同机认证反向代理必须使用显式 Host 白名单和服务端注入 token。POST 还必须为 JSON。普通动作上限 64 KiB，导入上限 2 MiB。action 联合中没有命令、可执行路径、shell 文本或任意参数字段。

## Agent 工具

看板不止能从界面操作，也能从对话里操作。每个工具都驱动同一个 Host 账本，因此在界面创建的任务对 agent 立即可见，反之亦然；界面遵守的每一道门禁在这里同样生效。工具面跟随 `enabled` 开关：看板关闭时不响应任何工具调用；运行时不提供工具注册表的部署仍会正常挂载看板，界面不受影响。

- `task_board_list`：按列、父任务、仅根任务、标签、自由文本与归档状态筛选卡片，并返回看板摘要——revision、时区、子任务深度上限、会话默认权限与各列计数。
- `task_board_get`：读取单张卡片的完整信息——Prompt、标签、父任务链接、直接子任务、执行目标、计划、权限门状态，以及最近十次执行（含会话 id、发起方与结果）。
- `task_board_create`：创建任务；带 `parentId` 时创建子任务。未单独设置的执行目标继承父任务，并受部署的子任务深度上限约束。
- `task_board_update`：修改内容、标签与执行目标；空字符串清除某个目标，空标签数组清除全部标签。
- `task_board_set_parent`：把现有卡片挂到某个父任务下，或用空 parentId 解除关联。
- `task_board_run`：立即执行一张卡片（可选择重跑已结算的卡片），并级联执行它整棵子任务树；会消耗真实 API 额度，且未确认的高于默认权限的绑定会以 `confirmation-required` 被拒绝。
- `task_board_manage`：把卡片移到任意列——只写列、绝不伪造执行记录，因此待规划/待办用于规划、已完成/已失败用于声明工作在受追踪的执行之外结束、进行中用于表示工作正在进行但没有会话；真正有未结算执行的卡片会拒绝移动直到结算——归档或恢复、删除，或对看板已无法观察的运行中卡片强制结算（记为 cancelled 并记录调用者原因，卡片回到待办），同样受 Host 的运行中子任务与父子关系护栏约束。
- `task_board_schedule`：启用、修改或关闭卡片的 cron 计划，包括其 IANA 时区（`timeZone` 传空字符串即清除，回退到 Host 时区）。

这里刻意没有「确认权限」工具：该门禁存在的意义就是由人工放行高于默认值的权限，若 agent 能自行盖章，这道门就形同虚设。遇到 `confirmation-required` 的 agent 应当请用户在界面确认该卡片。工具调用带归属：执行会把发起会话记为 initiator，创建/更新则会把发起会话写进续接卡片快照。

## 安装

安装聚合包或单独安装本包，然后重启 `dsh web`：

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-task-board@latest
```

本地开发安装：

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install
pnpm build
dsh plugin --profile web add link:$(pwd)/packages/dsh-task-board
```

## 配置

本插件的设置卡把选项组织成可折叠的分区——看板与运行行为、任务验收，以及提供方扩展（GitHub Issues 集成）贡献的分区。每个分区默认折叠，整张卡共用一次保存。

| 键 | 默认值 | 行为 |
| --- | --- | --- |
| `enabled` | `true` | 启用 Host 服务与浏览器看板。 |
| `announceToAgent` | `false` | 按需开启：开启后向 agent 系统提示加入任务看板说明。 |
| `preventIdleSleep` | `false` | 存在运行中的 DSH 会话、已启用计划或未知会话状态时，持有一个系统空闲睡眠断言。 |
| `trustedProxyHosts` | `[]` | 仅通过已认证 loopback 反向代理路径接受的规范 `host[:port]` authority 白名单。 |
| `proxyTokenEnv` | `DSH_TASK_BOARD_PROXY_TOKEN` | 保存反向代理 token 的环境变量名；token 本身不会写入插件配置。 |
| `sessionDefaultPermission` | 跟随宿主 | 权限确认门的显式基线。未设置时跟随宿主自己的默认权限预设（DSH 新会话的起始权限），部署不提供权限目录时回退 `read-only`。卡片有效权限（交接包或钉住字段）高于该基线时，运行前必须经人工确认；cron 拒绝调度待确认卡片。 |
| `maxSubtaskDepth` | `1` | 子任务深度上限，1 到 3。取 1 时一个任务只能有一层子任务，子任务不能再创建或关联子任务；每多一层，执行根任务一次开启的会话数就会成倍增加。 |
| `sessionPollSeconds` | `5` | 看板有需要核对的事情（运行中的卡片或未结算执行）时，Host 重新读取 DSH 会话名册的间隔秒数。两者都没有的空闲看板完全不轮询。取值 1 到 300；间隔越短结算越快、Host 负载越高。 |
| `goalVerification` | `true` | 本插件所开执行的 goal 验收。开启后，任务执行内的 `update_goal(action: complete)` 在该执行取得验收通过记录前一律被拒绝。只影响以 goal 形式执行的运行：普通聊天与钉住 `goalRun: false` 的任务不受影响。单张任务卡可以用「跳过本任务的验收」勾选退出本开关的约束（见下）。 |
| `goalVerificationModel` | `''`（继承） | 裁判模型路由，形如 `provider/model`。留空继承宿主模型目录的默认路由，绝不是任务卡钉住的执行模型。 |
| `goalVerificationReasoningEffort` | `''`（继承） | 裁判推理强度。留空继承宿主默认档位；目标模型未声明的档位绝不传参，回退到该模型自身默认档位并记录、展示。 |
| `goalVerificationCallTimeoutSeconds` | `150` | 单次裁判调用的上限（秒，范围 30–600）。一次验收要发六次裁判调用，上限过小会把「慢但健康」的路由变成一整排超时。 |
| `goalVerificationBudgetSeconds` | `1200` | 单次验收的总时间上限（秒，范围 120–1800），覆盖证据渲染与全部裁判调用（含重试）。应不小于单次调用上限的六倍，否则一次验收永远跑不完；耗尽时记为一类「预算耗尽」结果，不产生任何判定，也不消耗任何额度。 |
| `teamProvider` | `spawn` | Agent Teams 服务用来组成 teammate 的 continuable-subagent provider。仅团队执行模式使用，与 Agent Teams 工具插件的 `freshProvider` 默认值一致。 |

浏览器直接访问仍限制为 DSH loopback origin。若使用同机认证反向代理，应让 DSH Web 绑定 loopback，配置 `trustedProxyHosts`，在 `proxyTokenEnv` 指定的环境变量中放置高熵 token，并让代理在完成认证后替换（不能透传客户端提供的）`X-Dsh-Task-Board-Proxy-Token`。代理 Host 必须在白名单内，浏览器 `Origin` 必须与其 authority 相同。修改这些 composition 级代理设置后需重启 Host。

macOS 后端启动 `/usr/bin/caffeinate -i -w <host-pid>`，绝不请求 `-d`。Windows 后端从 `SystemRoot` 启动绝对路径的 Windows PowerShell，固定 helper 只请求 `ES_CONTINUOUS | ES_SYSTEM_REQUIRED`；不请求 `ES_DISPLAY_REQUIRED`，不修改电源计划，也不需要管理员权限。Linux 后端只从 `/usr/bin/systemd-inhibit` 或 `/bin/systemd-inhibit` 启动 systemd-logind `idle` block inhibitor，不请求 `sleep`、`handle-lid-switch` 或显示器/屏保 inhibitor；没有 systemd-logind 时显示 `unsupported` 或可见错误，不启动桌面环境专用替代命令。其他平台报告 `unsupported`。

## 数据存储与迁移

- 权威账本文件固定为 `$DSH_HOME/task-board/ledger-v2.json`（文件名为历史沿用）；当前文档 schema 为 v5，更旧的文档（v2/v3/v4）会在下一次 Host 启动时逐字段无损迁移并原地写回。POSIX 新文件权限为 `0600`；Windows 继承用户目录 ACL。
- v5 增加每 execution 的验收块（`verification`）。迁移刻意不补写该块：v5 之前开启的 execution 仍按历史判定结算，不会因为一个从未为它武装的完成门而被追溯验收。无法解析的验收块会被丢弃（该 execution 视为未验收，fail closed）；import 带入的 execution 记录一律剥离该块，否则伪造的通过记录会让导入的工作看起来已验收。
- v2 到 v3 迁移失败（任务行结构非法）时失败关闭并报出明确错误，原文件保持不动；绝不静默以空账本重启。损坏或未知 schema 的文件会移动到防碰撞的 `ledger-v2.json.corrupt-*` 名称，Host 以空账本和可见 scheduler 错误启动，不覆盖损坏字节。
- 每个 origin 首次加载新版页面时，按稳定 source id 和 request id 导入 `dsh.taskBoard.v1`。任务按 id 合并，浏览器端严格较新的顶层字段优先，时间戳相同时保留 Host 字段，执行记录按 execution id 合并。
- 最近 256 个 request id 与动作的 SHA-256 指纹会随账本持久化，因此 Host 重启后的变更重试仍保持幂等，且不会复制完整动作载荷。
- 外部结果 execution 记录只新增一个可选布尔字段（`external`）。该字段出现之前写入的账本没有它，读取时既不会凭空补写、也不会把「没有该字段」当成外部执行，因此旧文档原样读回；非布尔值会被丢弃，不会被当成可信来源标记。账本仍保持 v5：该字段在既有行里一律缺席，正是 v5 迁移已描述的那种增量变更。
- 任务标签是任务行上的可选 `tags` 字段（`{ name, promptPrefix? }[]`），无需 bump schema：不含该字段的 v3 文档原样加载，非法的标签列表逐条修复（丢弃空名、重复项与超长名，并封顶数量），而不是丢掉整行任务。
- /goal 选项是任务行上的可选 `goalRun` 字段，同样无需 bump schema：缺席即开启，显式 `false` 是退出选择，多写的 `true` 在加载时被修复回缺席。
- 只有导入成功并经 Host 确认后，`dsh.taskBoard.v2.hostImported` 才保存当前 Host 账本 generation；新建或损坏恢复出的新 generation 会再次接收保留的 v1 数据。v1 localStorage 原值保持不变，作为只读回退备份。
- 同一时间只有一个 Host 进程能通过 `$DSH_HOME/task-board/ledger-v2.lock` 持有任务看板账本目录；第二个使用同一 DSH home 的 Host 会失败关闭，不并发写账本。

## 安全模型

- 插件仍处在 DSH Web 既有部署与网络边界内，不返回宽松 CORS 头。state、action 与 SSE 共用同一访问栅栏；裸本地命令行请求不会被当作浏览器请求接受。
- 所有变更载荷使用严格、版本化的判别联合；浏览器不能写入 scheduler 独占时间戳或 execution 结果。
- 工作区、预设、权限、cron、任务状态和导入记录都会在 Host 再校验。
- 卡片有效权限高于配置的会话默认值时进入待确认状态：人工确认该确切绑定之前，Host 拒绝手动执行与 cron 触发；变更钉住权限或交接包会清除确认（封死先确认后替换的提权路径）。
- 任务 Prompt 是发给 DSH agent 会话的数据。协议不接受 shell 命令、PowerShell 正文、可执行路径或可配置 helper 参数。
- 任务标签与 Prompt 同属客户端断言，并走同一条受门禁的动作通道：协议层拒绝空标签名、未知键、超过八个标签以及超长的标签名或执行提示。标签的执行提示会做分隔符转义（无法伪造续接卡片的来源声明标记），且注入位置在该来源声明包裹之外。
- 子任务父子关系由 Host 而非浏览器判定：父任务必须存在且在看板上、任务不能挂到自己的后代之下、结果深度不得超过 `maxSubtaskDepth`。子任务若不单独设置权限，会在启动时解析父任务的绑定以及父任务的人工确认——绑定绝不复制到卡片上，因此解除关联不会残留一张已确认的高权限任务；一旦单独钉住权限，就重新回到确认门之下。若子任务树中存在未确认的绑定，整次运行会在任何会话启动前被拒绝，cron 则滚动到下一触发点。
- Agent 工具面经进程内服务直达同一个 Host 账本，而不经过 HTTP 栅栏，并且不携带任何确认能力：拒绝语义、失败即关闭的钉子、深度门禁与运行中任务锁全部照旧生效，任何工具调用都无法解除高于默认权限的绑定。
- 电源 helper 使用固定可执行路径、固定参数、`shell: false`，失败后按 1、2、5、10、30 秒有界退避。Linux helper 通过 Host stdin 生命周期退出，使 systemd inhibitor 随 Host 异常退出自动释放。

## 构建与测试

需要 Node 20 或更高版本及官方 NPM SDK 包；不使用 DSH 源码 checkout。

```sh
pnpm --filter @linxin666/dsh-client-ui-task-board typecheck
pnpm --filter @linxin666/dsh-client-ui-task-board test
pnpm --filter @linxin666/dsh-client-ui-task-board build
```

设置 `DSH_POWER_SMOKE=1` 可在 Windows、macOS 或 Linux 上显式启用原生 helper smoke：真实启动固定 helper、等待 ready、在清理路径释放并确认进程退出，不修改系统电源计划。Linux 会先以有界超时探测 systemd-logind；没有可用 system bus 时原生部分跳过，纯逻辑测试仍可运行。

## 手工验证

1. 挂载插件并重启 `dsh web`，打开任务看板，确认 Host 时区和电源状态可见。
2. 新建并编辑任务；刷新或打开第二个同源标签页，确认两者显示同一 Host revision。
3. 执行一个钉住工作区、预设和权限的任务；确认出现新会话，并由该会话的 `turn/end` 历史结算任务。
4. 在勾选 /goal 选项的情况下执行一个任务：确认会话启动了目标，卡片在多轮续跑期间保持 `running`，直到目标完成后结算为成功。取消勾选后再执行一次，确认变回单回合、由一条 `turn/end` 结算。
5. 启用一个即将到期的 cron，关闭全部浏览器页面，确认 Host 仍只创建并结算一次 execution。
6. 让 Host 停止并错过一个 cron 触发点，重启后确认该次被跳过，`nextRunAt` 从当前 Host 时间向后滚动。
7. 开启 `preventIdleSleep` 并运行长任务，让显示器自动熄灭；恢复显示后确认会话继续且 execution 已结算。
8. 关闭设置并禁用所有计划，再停止 DSH，确认 helper 退出；macOS 可用 `pmset -g assertions` 辅助确认插件没有 display-sleep assertion。
9. Linux 可用 `systemd-inhibit --list` 确认只存在 `idle`/`block` 条目；显示器仍按桌面设置关闭，手动睡眠和合盖仍由系统策略处理。

## 已知限制

- Host 停止、系统睡眠或长暂停期间错过的触发点会跳过，绝不排队补跑。
- 同一任务已在运行时会跳过到期出现并滚动到下一 cron 匹配点；任务运行不并发、不排队。
- DST 采用 Host 本地墙上时钟语义：春季跳时中不存在的分钟会跳过，秋季回拨中重复的分钟不会执行第二次。
- 电源保护只阻止空闲系统睡眠，明确允许显示器睡眠与锁屏。
- 合盖、手动睡眠、休眠、关机、低电量强制睡眠和企业电源策略不在保证范围内。
- 插件不创建唤醒定时器，也不能唤醒已经睡眠的机器。
- Linux 需要 systemd-logind 及允许当前用户取得 idle block lock 的策略；容器、WSL、无 system bus 或非 systemd 系统可能显示 `unsupported` 或 `error`。桌面环境是否把 logind idle lock 与显示器空闲联动属于其自身策略，插件不请求屏保或显示器 inhibitor。
- 已启用计划会从未来触发点之前持续持锁，因此可能增加电池消耗。
- Host 执行消耗与普通 DSH agent 会话相同的 API 额度。
- 执行一个任务会同时执行它的子任务树：每个成员都会立刻开启一个 DSH 会话，树越深并发会话越多，每个会话都会消耗 API 额度。
- Agent 工具调用由模型驱动：从对话发起的执行或定时级联同样消耗 API 额度，且 agent 可以启用一个持续触发的计划，直到被关闭或看板被关掉。
- 目标执行会按目标需要不断续跑：每一轮都消耗 API 额度，会话会一直忙碌，直到目标完成或被 dsh 阻塞（轮次上限、回合被拒或入队失败），后者在看板上记为执行失败。
- 目标模式依赖运行时的 `/goal` 命令与命令派发器。两者都不提供的部署仍会把每张卡片当单回合执行，并在宿主日志中记录目标模式不可用，而不是让执行失败。

- 每次验收都会消耗模型请求：一次验收是 3 项判据 × 2 轮（6 次裁判请求），而同一 execution 最多验收两次，因此一个需要修复一次的 goal 周期最多在任务本身之外多花 12 次请求。
- 验收不估费用：本部署无法为目标裁判路由提供可靠的分 token 价格来源，报告只列出 token 用量。
- 宿主观察的工作区变更块只在部署确实记录变更且读取成功时出现；服务不可用或对比读取失败时，证据降级为只判轨迹，而不是让验收失败。
- 验收只在能生效的地方强制执行：没有成为 goal 执行的运行（`/goal` 被拒绝或不可用）与团队执行的 teammate 成员不受门禁，记录会明确说明，而不是暗示它们已被验收。宿主不提供模型目录时无法解析裁判路由，完成声明按 fail closed 拒绝并记为验收异常；异常额度用尽后卡片保持打开而不是判死，恢复需要用户清除这些异常。
- 第一版一律使用 coding 判据：没有自动 rubric 选择，非工程任务也按工程判据评判（设置界面已说明）。
- 若第三方验收插件（例如已安装的 `dsh-llm-verifier`）也开启了自己的自动验收，两个裁判会各自对同一会话评分：本看板的验收决定能否完成，另一个只做提示，公开 SDK 接口无法让二者共享同一判定。要避免为两次判定付费，只能关闭对方的自动模式。

## 数据遥测

浏览器半区每个 UTC 日向 dsh-market.com 发送一次匿名安装心跳：仅含一个 localStorage 随机 ID 与本包名，无其他数据。服务端只存储该 ID 的加盐哈希，不存 IP，且只暴露聚合计数。完整契约见 [docs/telemetry.md](../../docs/telemetry.md)。
