# dsh-liangshen — 梁神模式（极简 persona + 程序化工具传输）

[English](README.md) | 中文

把梁神模式做成 DSH 全家桶里的一键安装插件：Host 半区在激活时把内置 preset 直接声明给 harness 的 agent-preset registry（声明即启用），新建会话即可在预设选择器中选择「梁神模式」，浏览器半区还在新建会话页的模型选择器旁提供一台老虎机拨杆来开关该模式。该 preset 让系统提示词保持极简 persona——外加本模式的固定工作纪律与会话工作区目录——AGENTS.md 类工作区指令交由 harness 以自己的 user 角色消息送达；工具面则从第一条用户消息起作为持久 user 消息注入在用户消息之后——形状与 harness 注入 skill 目录一致，且只宣告该次请求实际开放的工具。wire 在整个会话中保持由 `presentation` 选定的同一种呈现（出厂默认 `presentation: 'both'`）：原生清单与 `run_code` 传输工具同驻——日常单步工作走原生直调，程序化批处理、并发扇出与多步数据塑形走 `run_code`；未挂载 code runtime 的部署回退为原生呈现并一次性告警，而不是宣告一个该请求无法承载的传输工具。被分页扣留的匹配工具（默认 `mcp__*`）在激活前不可达：它们以命名空间摘要出现在目录里，`ptc` 下同时不出现在生成的 SDK 中——分页是注册表级限制，不只是 wire 过滤。`tool_activate` 把一个命名空间挂回整个可达面。全部通过官方 NPM SDK 实现，不修改 DSH 源码。

## 原理

DeepSeek V4.1 Flash 的后训练直接对齐其原生 DSML 工具调用面，官方脚手架横评中代码 Agent 基准上原生极简面领先于程序化（PTC）面（DeepSWE v1.1：72.6% 对 67.6%；Terminal-Bench 2.1：90.6% 对 85.8%）。而真实工程会话依赖 MCP 服务与插件生态——封闭的 4 工具极简面在物理上够不到它们，无边界平铺的全量清单又会把会话内容埋在工具定义之下。

梁神模式因此在整个会话中保持由 `presentation` 选定的同一种呈现。出厂默认为 `both`：原生清单与 `run_code` 传输工具同驻——这是官方横评数据支持的方向（原生面在 DeepSWE v1.1 与 Terminal-Bench 2.1 上均领先 PTC：72.6% 对 67.6%、90.6% 对 85.8%），同时保留 `run_code` 作为程序化批处理与并发扇出的特化出口。`native`（去掉传输工具的纯原生面）与 `ptc`（wire 收拢为 `run_code`，静态上下文最省但官方横评垫底的呈现）都保留为一行切换的选项。被分页模式匹配的外部工具（默认 `mcp__*`）先以命名空间摘要宣告，`tool_activate` 激活前既不在 wire 上、`ptc` 下也不在生成的 SDK 中（分页施加在程序分派所依据的注册表上），静态 Schema 面因此保持小巧。本模式不承诺基准领先，只保证「目录宣告的面」与「请求 wire 实际携带的面」永不矛盾。

## 工作机制

1. `minimal-prompt` 把每次组装出的提示词收窄到 persona 一段——一行 persona、本模式的固定工作纪律（同一假设的思考推演不超过两轮，缺少事实时立即闭合思考并调用检查工具而非空想；思考只决定下一步具体操作，不预演完整代码实现；多处独立检查或搜索在单轮内并发发射多个工具调用；Shell 为无状态进程，跨调用目录不保留，子目录操作使用复合命令或显式 workdir；正确性一律在执行阶段以工具实际输出验证；YAGNI 与 PDCA；不写冗余注释）、以及一行从会话头读取的方位信息 `Your working directory is <cwd>.`——因此 harness identity、web surface、工具用法、文件引用与结构化输出等 section 默认不会到达模型；plan mode 的 `plan:policy` 保留，因为该 section 是 plan mode 唯一的执行依据（它的退出工具在任何模式下都保持注册）；
2. AGENTS.md 类工作区指令经 `instructionSource` 送达模型：默认（`host`）下 preset 不追加任何自有段，也不改动宿主自己的送达，工作区指令以宿主的 user 角色消息抵达——一条持久基线，加上触碰目录后的增量、替换与移除；`system-prompt` 下它们直接进入系统提示词本身：组装时 `minimal-prompt` 读取 harness 的基线链（`$DSH_HOME/AGENTS.md`，再从项目根到会话 cwd 沿途的 `AGENTS.md` / `CLAUDE.md` 及其 `.local` 覆盖层），把内容作为一段 `workspace-instructions` 追加在稳定前缀之后，受字节预算约束——放不下时先省略最宽的文件、最后才截断最具体的文件；读取在每次组装时都发生，文件改动无需持久消息即可在下次请求生效，harness 自己的 agent-instructions 注入则被丢弃以免与提示词重复。工作区子目录动态规则后续将支持注册文件工具（含 `str_replace_editor`）及 `run_code` 内子调用触达的目录；不解析任意 bash/program 代码，不保证 shell 自行文件访问的自动发现；
3. wire 在整个会话中保持由 `presentation` 选定的同一种呈现：`both`（出厂默认）让原生清单与 `run_code` 传输工具同驻，目录文案明确「原生直调优先、`run_code` 仅用于程序化批处理/并发扇出/重计算」；`native` 携带组装出的原生清单；`ptc` 把 wire 收拢为 `run_code`、其余工具经生成的 SDK 调用；`ptc` 与 `both` 需要挂载的 code runtime；没有时插件不做声明，会话直接运行原生工具面。旧键 `ptcPresentation` 映射到 `ptc`/`native` 并发出弃用告警，已退役的 `anchorTools` 首回合收窄不再生效——设置它会收到告警；
4. `tool-catalog` 把工具清单作为持久 user 消息追加在用户消息之后，保留完整输入输出关键参数语义（`descriptionMaxLength: 200` 仅限制一行摘要长度）。目录只宣告该次请求实际开放的工具——原生清单加上同驻时的 `run_code`——并在分页开启时为被扣留的命名空间附上一行摘要；`ptc` 下这些摘要代表真正不可达的命名空间——既不在该请求的 `tools:sdk` 段中，也不能在 `run_code` 程序内调用——直到 `tool_activate`；只在工具面变化、或已发布副本离开可见面（压缩、恢复）时重发；
5. 温和分页出厂开启（`pagedToolPatterns: ['mcp__*']`）：匹配的 MCP 工具被扣留在 wire 与生成的 SDK 之外，以命名空间摘要出现在目录中，直到模型经 `tool_activate({ namespace })` 激活——激活的命名空间从下一个请求起重新可达，最多保持三个已激活的分页命名空间（激活第四个时将最久未用的逐回摘要状态）。激活状态从持久事件流重建，压缩与恢复均可还原；
6. 最小版 working-context 行——plan-mode 状态、已激活的分页命名空间、进行中的 todo——只在其来源可读时注入到最新消息尾部，让当前状态落在模型的局部注意力窗口内；运行时上下文（sandbox 与 approval 快照）与 skill 目录按 Standard 模式正常注入；
7. 目录把已激活分页家族的工具归在 `namespace `<名称>` (activated):` 标题之下，而不是把一个服务端的工具散落在字母序清单里；未被分页的工具仍保持扁平条目；
8. `maxResidentTokens`（默认 8000）估算常驻 wire 面并在超过时告警一次，列出最重的工具并把 `pagedToolPatterns` 指为处置手段。该阈值按 V4.1 的 KV 压缩重新校准（其 KV cache 为 V4-Flash 的 1/4，同样的 schema 负载只占 1/4 的稀疏索引槽位，阈值由 6000 上调至 8000），仍校准在出厂清单之上，用于发现真实增长而非出厂配置本身。该守卫从不截断：静默丢掉会话需要的工具，等于用可度量的上下文成本换取不可度量的能力损失。
9. 运行时退化熔断器（`guard`）每步从会话事件流折叠信号，在两类形态下每个 episode 触发一次——停摆（连续零产出的长思考回合）或空转（同一工具以相同参数连续失败）——注入熔断消息，并在接下来几个请求内把推理档位临时下调一档（max → high → low）；无信号时它从不改写任何请求，路由的显式档位与前缀缓存都不受影响。这是 persona 反思熔断无法充当的外力（DSH discussion #5976）；
10. 关键事实登记簿（`fact_register`）让模型把用户硬性约束、已确认的架构决策、失败过的路径登记为一行短事实；登记簿从持久事件流折叠，随 `[Working Context: ...]` 行投射——每步都落在保证命中的局部注意力窗口内——以此对抗 V4.1 的长会话遗忘。

## 安全模型

本模式坚持在官方宿主安全架构内运行，严格遵守沙箱策略：

- **宿主沙箱约束**：所有文件工具——原生呈现的 Standard 文件工具，以及 `run_code` 程序经 SDK 分发的任何文件操作——均受宿主文件沙箱策略约束，继承当前会话的沙箱级别（如 `danger-full-access` 或只读/工作区受限）。不存在裸本地文件系统访问（不挂载 `dsh-fs-local`），所有跨越工作区的读写均受宿主策略拦截。
- **两个平台都挂标准 shell**：本 preset 在每个宿主上挂载上游的标准 Stdio shell 栈，与内置 Standard 一致。POSIX 挂 `bash`（`@deepseek-ai/dsh-tool-bash`）；win32 挂 `pwsh`（`@deepseek-ai/dsh-tool-pwsh`）。每个平台恰好暴露一个 shell 工具（POSIX 为 `bash`，win32 为 `pwsh`），带有主动语态简短描述标题卡片与确定性退出码。本 preset 不自带任何 shell 实现。
- **代码运行时沙箱**：`run_code` 程序运行于独立的 worker thread 隔离上下文，其对系统资源的访问完全受限于 SDK 暴露的 tools 边界。

## 拨杆

浏览器半区在新建会话页的输入框工具行里、模型选择器紧左侧装了一台老虎机拨杆：

- 把拨杆拨下——拖动、点击或用键盘激活都算——即将开始的会话就组合为梁神模式；命中后播放中奖特效（闪光、冲击环、火花，以及「梁神模式」横幅叠文言文、二进制、摩斯三行）；
- 把拨杆上拨，就回到你此前的模式——还没有记住任何模式时，回到部署默认预设；
- 拨杆始终反映会话真实的预设，刷新页面后状态依然正确；且只在会话仍为空时渲染——会话一旦开始，宿主拒绝重新组合，整行控件直接从输入框中消失；
- 被拒绝的切换会在拨杆下方显示宿主给出的原因，且不播放特效；`prefers-reduced-motion` 下保留状态变化、去掉动画。

拨杆通过浏览器会话已经完成鉴权的 agent-preset Remote 命名空间驱动会话预设，不额外申请权限。它只在会话为空时改动预设，而那正是它渲染所在的新建会话页。

## Preset 配置

两个 preset 内置插件都在 `agent.cordis.yml` 中配置：

| 键 | 默认值 | 行为 |
| --- | --- | --- |
| `keepPlanPolicy` | `true` | 在只有一行 persona 的系统提示词中保留 plan mode 的 `plan:policy` 段。置 `false` 得到严格的一行表面，此时 plan mode 背后没有任何策略文本。 |
| `instructionSource` | `host` | 工作区指令送达模型的方式。`host`（默认）不追加任何自有段，也不改动宿主的 agent-instructions 注入，工作区指令以宿主自己的 user 角色消息送达：一条持久基线，加上触碰目录后的增量、替换与移除；`system-prompt` 在组装时读取 AGENTS.md 链并追加进系统提示词（harness 自己的注入被丢弃）；`hint` 把首次注入替换为一次性的、非命令式的参考文件提示，后续注入丢弃。 |
| `instructionMaxBytes` | `65536` | 渲染后的 workspace-instructions 段的字节预算，仅在 `system-prompt` 模式下生效：最宽的文件先被省略，最具体的文件最后被截断。 |
| `descriptionMaxLength` | `200` | 注入目录中单个工具一行摘要的长度上限。完整关键参数语义保持完整。 |
| `presentation` | `both` | 整个会话的 wire 呈现方式。`both`（出厂默认）保持完整原生清单并同驻一个 `run_code`（原生直调优先、传输工具用于程序化批处理与并发扇出）；`native` 保持组装出的原生清单；`ptc` 把 wire 收拢为 `run_code`，其余工具经生成的 SDK 调用。`ptc` 与 `both` 需要挂载的 code runtime；没有时插件根本不做声明，会话直接运行原生工具面。 |
| `pagedToolPatterns` | `['mcp__*']` | 出厂开启温和分页：命中的 MCP 工具被扣留在 wire 与生成的 SDK 之外，直到模型通过 `tool_activate({ namespace })` 激活其命名空间。被扣留的命名空间在目录中以一行摘要出现。最多同时保持三个已激活的分页命名空间，激活状态从持久事件流重建。 |
| `maxResidentTokens` | `8000` | 常驻 wire 面的估算 token 上限（按序列化 schema 约四字符一 token），按 V4.1 的 KV 压缩重新校准后仍高于出厂清单，用于发现真实增长而非出厂配置本身。超过时告警一次、列出最重的工具并指向 `pagedToolPatterns`；不会截断工具清单。 |
| `ptcPresentation` | （已退役） | 旧别名：`true` 映射为 `presentation: 'ptc'`，`false` 映射为 `'native'`，两者都伴随弃用告警。 |
| `anchorTools` | （已退役） | 首回合锚定收窄已移除；设置该键会收到告警，且不再收窄 wire。 |

## 安装

```sh
# 方式一：全家桶（推荐）
dsh plugin --profile web add @linxin666/dsh-web-all@latest

# 方式二：单独安装
dsh plugin --profile web add @linxin666/dsh-liangshen@latest

# 两种方式二选一：聚合包与独立 @linxin666/dsh-liangshen 都会挂载本 preset。
# 需要在两者之间切换时，先 dsh plugin remove 移除另一个再安装：
dsh plugin --profile web remove @linxin666/dsh-liangshen
```

装完**完整重启 `dsh web`**，新建空 session，预设选择「梁神模式」。插件在激活时用包内自带文件声明该 preset，插件（或其行）卸载时注销；不会向 `~/.dsh/.agent-presets` 写入任何内容，升级后在下次启动即生效。

## 验证

导出 session JSONL，检查 `request/header`：

- `instructionSource: host` 下第一份 header 的 `system` 应恰好是 persona 块（极简 persona、工作纪律清单、工作区目录行 `Your working directory is <cwd>.`）加上 plan mode 开启时的策略段——AGENTS.md 链则以宿主自己的 user 角色消息抵达；`instructionSource: system-prompt` 下 `system` 改为多出一段 `workspace-instructions`；
- 每份 header 在整个会话中保持同一种呈现：默认 `presentation: 'both'` 下 wire 同驻原生清单与 `run_code`，任何回合边界都不会再收窄 wire；
- 放行的消息里应有一条来自 `liangshen-tool-catalog` 的 `plugin` 消息，位于用户消息之后，按参数签名恰好列出该次请求开放的工具；被分页扣留的工具以一行命名空间摘要出现；
- `ptc` 下未激活的命名空间既不出现在该请求的 `tools:sdk` 段中，也不能在 `run_code` 程序内调用——**从第一个请求起**成立，而不是晚一个请求；
- `tool_activate({ namespace })` 成功后，该命名空间的工具从下一个请求起进入 wire，且同时激活的分页命名空间不超过三个；
- 压缩之后目录会重发一次，形式为替换清单，分页激活状态从持久事件流重建，呈现模式保持不变；
- 文件写入受宿主文件沙箱策略约束，不存在裸本地文件系统绕过。

### 真实会话验证条件与评测说明

在进行模式验证与性能评估时，必须严格区分验证层级：

1. **真实推理探针 ≠ 模式集成通过 ≠ 统计提升**：
   - **真实推理探针**：仅验证链路连通性与模型对特定格式的最小响应能力（例如使用 headless 探针验证模型是否能正常解析输出）；单次探针成功仅代表功能未阻断，绝不证明模式集成已达标。
   - **模式集成通过**：要求在真实完整会话中，验证完整 header、所配置呈现行为、分页激活与驱逐、`run_code` 下的 SDK 参数语义解析与沙箱策略执行无误。
   - **统计显著性提升**：必须在固定 route 与源码 hash 记录的隔离环境中进行多轮对比评测，综合评估任务完成率、工具失败率、规则违反率、人工介入次数与耗时/token 开销。单次或少数 smoke 运行不构成效果提升的证据。
2. **评测工具**：隔离 runner 位于 `packages/dsh-liangshen/tools/benchmark-live-run.mjs`：它把被评测 preset 物化到临时目录，并通过 variant patch 在本轮自己的 agent-preset registry 中声明它，把会话持久化改写到本次运行目录，并为每次运行记录基线（仓库提交、出厂 preset hash、DSH 版本、固定 route、任务版本）。候选矩阵隔离 persona 与呈现策略两个因素：`B`（出厂默认）、`P`（候选 persona）、呈现臂 `T`（候选 persona，首轮即 PTC）与 `N`（候选 persona，全程原生清单）、以及 `M`（内置包官方 Minimal preset，仅作外部参照而非单因素对照）。单次 smoke 用 `node tools/benchmark-live-run.mjs --variant B`，按种子任务集跑有界矩阵用 `node tools/benchmark-live-run.mjs --tasks tools/tasks/liangshen-v41-flash.json --groups B,P,T,N,M --repeat 3 --max-sessions 60 --budget-usd 5`，再用 `node tools/benchmark-report.mjs .benchmark-results` 汇总结果目录：按组给出成功率与 Wilson 区间、按任务配对差值与置信区间、token 与费用合计、单独列出的基础设施失败以及记录的基线。smoke 只验证协议与费用估算，不构成通用编码能力提升的证据。

## 配置

| 键 | 默认值 | 行为 |
| --- | --- | --- |
| `enabled` | `true` | 总开关：关闭后不声明预设、也不发公告。 |
| `announceToAgent` | `false` | 按需开启：开启后向 agent 系统提示注入本插件公告。默认关闭，保持系统提示词干净。 |
| `presentation` | `both` | 写入本插件所声明 preset 之 `tool-catalog` 行的 wire 呈现：`both`（默认）让原生清单与 `run_code` 同驻；`native` 保持组装出的原生清单；`ptc` 把 wire 收拢为 `run_code`。Host 提交改动后立即重新声明 preset，此后新建的会话即采用新值；已开始的会话保持其已声明的组合。 |
| `guardEnabled` | `true` | 运行时退化熔断器总开关：检测连续零产出长思考与同参重复失败，触发时注入熔断提示并临时下调推理档位；关闭后不干预任何请求。 |
| `guardSensitivity` | `balanced` | 熔断灵敏度预设：整体缩放阈值——`conservative`（更少打断，×1.5）、`balanced`（出厂校准值）、`aggressive`（更早触发，×0.5）。 |
| `guardStallReasoningChars` | `8000` | 单步暴走梯字符阈值的**覆写值**：阈值默认随推理档位自适应（max 档 8000 / high 档 12000 / low 档 20000，按 V4.1 官方 384K 最大输出校准），设置本字段则以本值为准、覆盖所有档位的自适应表。 |
| `guardGlobalStallCap` | `4` | 熔断器慢烧梯连续步数的**覆写值**：默认随灵敏度预设缩放（balanced 为 4），设置本字段则以本值为准。 |
| `guardEchoFailures` | `3` | 熔断器空转梯的**覆写值**：同一工具以相同参数连续失败多少次触发。以上熔断字段与 `presentation` 一样写入所声明的 preset 生效。 |

各字段都可在 Web 设置界面（插件配置）或 profile patch（`dsh plugin` / `cordis.patch.yml`）中编辑。0.1.7 的设置契约下，插件自身的 Config 就是它的设置页：Host 为每个 profile entry 生成一张表单（entry id 为 `liangshen`，聚合安装下为生成的 `web-ui-liangshen` 行），每个字段都声明为 `volatile()`，因此写入被提交进运行中的插件实例，而不是重挂该行。塑造 preset 的 presentation 字段再经声明抵达会话：插件把已提交的取值应用到 `presets/liangshen/agent.cordis.yml` 的对应行并重新声明 preset，因此真正被会话运行的是设置界面的取值，而不是包内文件。组合里没有的行或键绝不会被凭空写入——覆写只会收窄出厂配置。改动对之后新建的会话生效；已开始的会话保持其已声明的组合，因为 registry 拒绝重组已开始的会话。

## 行为与限制

- 系统提示词在整个会话中保持稳定：persona 块（persona、工作纪律、工作区目录），plan mode 开启时另加其策略段，`system-prompt` 模式下另加 workspace-instructions 段。工具调用后不会再追加内容，也不施加任何输出预算上限；
- `system-prompt` 模式下 workspace-instructions 段在每次组装时重新读取，指令文件的改动无需持久消息即可在下一次请求生效；该段渲染在稳定前缀之后的最后位置，缓存前缀不受影响。工作区子目录动态规则后续将扩展支持注册文件工具（含 `str_replace_editor`）及 `run_code` 内子调用触达的目录；不解析任意 bash/program 代码，不保证 shell 自行文件访问的自动发现；
- wire 在整个会话中保持同一种呈现——不存在回合边界跃迁：`both`（出厂默认）同驻原生清单与一个 `run_code`，`native` 携带组装出的原生清单，`ptc` 把 wire 收拢为 `run_code` 一条，其余工具经生成的 SDK 调用；
- 注入的目录是持久消息：每个会话写入一次，另在工具面变化（分页激活、呈现变更）或压缩遮蔽已发布副本时替换一次，并留在历史中供后续请求使用；
- 未观测到 prompt 组装的步不注入任何内容——目录绝不会由过期视图推测；
- 若组合中不存在任何被接受的 persona section 名（`deployment:persona-prefix`、`deployment:persona`、`persona`），过滤器会保留组装结果并只告警一次，而不是发出空系统提示词；
- plan mode 通过其 `plan:policy` 段支持；置 `keepPlanPolicy: false` 后该模式仍有工具，但失去约束它的策略文本；
- 被分页扣留的工具（出厂模式 `mcp__*`）在模型经 `tool_activate` 激活其命名空间之前不进 wire、也不进生成的 SDK；同时最多三个分页命名空间保持激活，激活第四个会把最近最少使用的逐回摘要状态，激活状态在压缩与恢复后从持久事件流重建；
- working-context 行只在其来源（plan-mode 状态、已激活的分页命名空间、进行中的 todo）可读时注入，否则省略；
- 工具结果超过 4096 字符即被修剪，保留 2048 字符头部与 1024 字符尾部（守护稀疏索引槽位的同时保住错误尾部与退出码），避免超大输出挤占上下文；
- `run_code` 需要挂载的 code runtime（随包发布的 web 与 headless 组合都挂载 `dsh-code-runtime-worker-thread`）；没有时 `ptc` 与 `both` 不做声明，会话运行原生工具面；
- 清单不发布 `workflow` 工具，而 workflow 引擎仍为 `ralph` 保留挂载；
- shell 挂载上游标准 Stdio 栈，POSIX 注册 `bash`，win32 注册 `pwsh`——每个宿主恰好挂一个 shell 工具，带简短功能描述标题卡片与确定性退出码；
- 文件工具继承宿主文件沙箱（不挂载裸 `dsh-fs-local`）；
- preset 与 shell 访问具有相同信任等级，安装前可自行审阅 `presets/liangshen/`；
- 插件不发起网络请求，也不增加遥测；
- 不要在已经产生内容的会话中途切换 preset；
- 需要 DSH 0.1.7-alpha.1+（preset 机制、`system-prompt/assemble` 瀑布、persona 的 `prefix` schema，以及 PTC 呈现 API）。

## 许可

插件本体 Apache-2.0（zhu1090093659）。`presets/liangshen/agent.cordis.yml` 基于 DeepSeek Harness 内置 Minimal、Standard 与 PTC preset 修改（MIT），版权与许可声明见 preset 的 `NOTICE`。
