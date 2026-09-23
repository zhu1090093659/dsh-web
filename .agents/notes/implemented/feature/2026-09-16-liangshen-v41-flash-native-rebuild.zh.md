# Agent Note: 梁神模式面向 DeepSeek V4.1 Flash 的原生重构

Status: implemented

部分取代[极简 persona 加注入式标准工具目录](2026-09-11-liangshen-minimal-prompt-tool-catalog.zh.md)的 persona 文本与分层 wire：工作纪律替换为行动触发式规则，锚定回合与第二回合 PTC 晋升退役；极简 persona 机制、注入目录机制与消息来源决定继续有效。部分取代[恢复四工具锚定与 PTC 语义修正](2026-09-12-liangshen-anchor-tools-and-ptc-refinement.zh.md)：`anchorTools` 首回合收窄被移除，`ptcPresentation` 由三态 `presentation` 键取代；如实激活语义、请求面目录契约与三层验证标准继续有效。部分取代[请求面工具目录与评测工具](2026-09-13-liangshen-request-surface-catalog-and-eval-tooling.zh.md)所跟踪的呈现边界——wire 不再在回合边界变化——其「恰好宣告请求开放的面」原则与评测工具继续有效。部分被[清理梁神模式动态推理努力度](../simplification/2026-09-17-remove-liangshen-dynamic-reasoning-effort.zh.md)取代：移除分阶段动态推理努力度机制与设置字段。以官方已发表的评测证据（而非本地付费矩阵）了结[梁神模式针对 DeepSeek V4.1 Flash 的改进计划](../../proposed/feature/2026-09-13-liangshen-v41-flash-improvement-plan.zh.md)的默认值选择阶段。完整设计推演见 `docs/liangshen-v41-flash-optimization.md`。

## Problem

两阶段设计——原生呈现的锚定回合加第二回合 PTC 晋升——建立在 DeepSeek V4 发布前社区假设之上，而非官方证据。DeepSeek-V4.1-Flash 技术报告自己的脚手架横评把原生极简面排在 PTC 面之前（DeepSWE v1.1：72.6% 对 67.6%；Terminal-Bench 2.1：90.6% 对 85.8%），且晋升边界迫使 `run_code` 之外的每个工具都经由生成的 SDK 程序调用，引入了原生 DSML 面所没有的语法与运行时失败模式。

同时本模式也无法退回封闭的 4 工具极简面：真实工程会话依赖 MCP 服务与插件生态，而把每个外部 schema 平铺进全量清单又会挤占模型的稀疏注意力预算（CSA2 每个 query 只检索有界的 Top-K 压缩块，庞大的静态 schema 面会挤掉会话内容）。persona 中抽象的防循环表述也被证明不足以对抗 RL 自省偏置——当工具结果与模型预期冲突时，该偏置会驱动封闭式思考死循环。

## Decision

preset 在整个会话中保持单一 wire 呈现，并把外部工具发现迁移到温和的分页机制上。

- `tool-catalog` 新增 `presentation` 键，取三个值：`native`（组装出的原生清单）、`ptc`（wire 收拢为 `run_code`，其余工具经生成的 SDK 调用；**出厂默认**）与 `both`（完整原生清单同驻一个 `run_code`）。默认值取 `ptc` 是一次**未测量的取舍**：它让原生清单的 schema 负载离开每个请求，静态上下文为三者最省；但官方已发表的脚手架横评把该呈现排在原生面之后（DeepSWE v1.1：67.6 对 72.6；Terminal-Bench 2.1：85.8 对 90.6），而本仓库尚未运行包内评测矩阵来裁决它。`presentation: 'native'` 是切回官方数据支持面的一行配置。`both` 与 `ptc` 需要挂载的 code runtime，缺失时回退为 `native` 并一次性告警。回合边界跃迁不复存在：选定的呈现从第一个请求持续到最后一个。旧键 `ptcPresentation` 映射到 `'ptc'`/`'native'` 并发出弃用告警；`anchorTools` 首回合锚定退役，设置它会收到告警且不再收窄 wire。
- 温和工具分页：`pagedToolPatterns`（默认 `['mcp__*']`）把匹配工具扣留在被执行面之外——作用域级 `tools.restrict` 把它们移出该作用域的可见集合，因此既离开组装出的 wire，也离开生成的 SDK 声明——直到模型通过 `tool_activate({ namespace })` 激活其命名空间。被扣留的命名空间在注入目录中以一行摘要出现；同时最多三个分页命名空间保持激活（激活第四个时逐出最近最少使用的那个，退回摘要状态）；激活状态从持久会话事件流重建，压缩与恢复都会还原出同一张工具面。
- persona 的工作纪律替换为行动触发式规则：同一假设的推演不超过两轮，随后立即闭合思考并调用检查工具；思考只决定下一步具体操作而不预演代码；正确性以工具实际输出验证。`tool-result-pruner` 收紧为 4096/1500/500 字符（阈值/头部/尾部）。本决定当时随包发布的 preset 自有 win32 Git Bash shell 此后已退役，改用上游持久 shell 栈的 pwsh 孪生，那行平台专属 persona 纪律也随之移除；见 [shell 与分页决定](2026-09-17-liangshen-shell-and-paging-ptc-surface.md)。最小版 working-context 行（plan-mode 状态、已激活的分页命名空间、进行中的 todo）只在其来源可读时注入到最新消息尾部。
- 静态 schema 面本身受一个诊断守卫看护：`maxResidentTokens`（默认 6000）按序列化 schema 约四字符一 token 估算常驻 wire 面，超过阈值时每次会话告警一次、列出最重的工具并指向 `pagedToolPatterns` 作为处置手段。该默认值刻意校准在本 preset 出厂清单之上——温和分页让全部非 `mcp__*` 工具常驻，出厂清单本身就在数千 token 量级，阈值若低于出厂基线会在每个寻常会话上误报，反而训练读者忽略它。该守卫只告警不截断——静默丢掉会话需要的工具，等于用可度量的上下文成本换取不可度量的能力损失。已激活分页家族的工具在目录中归在其命名空间标题下，未分页工具保持扁平条目；persona 另增 `Bounded Output` 一条纪律（在源头用 grep/head/tail/wc 过滤，禁止把大段命令输出倾泻进会话），因为长程注意力是有界预算，原始日志会把会话自身的约束挤出该预算。
- 插件的 Web 设置界面承载塑造 preset 的字段（`presentation` 与 guard 开关）。设置界面编辑的是插件自己的 Config，而塑造会话的取值住在 preset 的行配置里；两者在**声明时**汇合——插件从随包的 `agent.cordis.yml` 重建行列表，把已提交的取值并入它们所定位的行，然后重新声明该 preset，因此真正被会话运行的是设置界面的取值。组合里没有的行不会被凭空写入：覆写只收窄随包配置，不重写任何文件。
- 阶段判定识别三种情形：显式计划模式、**失败驱动的复核区间**（一次失败的派发开启，其后第一次成功的派发关闭），以及执行。复核档位默认取规划档位，因为诊断失败与制定方案是同类工作。失败与成功配对成区间，是为了让「修复—验证」循环从失败到修复成功全程保持深档位，而不是每次工具调用都来回切换。
- 分档由 `autoEffortByPhase` 开关把关，**出厂关闭**：关闭时插件不注册任何请求监听，请求与部署原本会发送的完全一致；开启后从下一个阶段边界起接管推理档位。之所以默认关闭，是因为会话的推理档位是模型选择器里一个可见且显式的用户选择，静默覆盖它会让那个选择看起来像是坏了；而"按需开启"也让一个绝大多数部署用不到的特性不出现在热路径上。
- `reasoning-effort` 插件加入宿主的 `agent/request` 水位（官方目录写明该事件为 waterfall，摘要即 "Replace the frozen call configuration"，按 agent 作用域派发），在 plan-mode 边界把请求的 `reasoningEffort` 从规划档位（默认 `'high'`）切到执行档位（默认 `'low'`）。只在边界切换，因为该字段参与请求头快照并决定缓存复用——逐回合翻转会为省推理 token 每回合付一次缓存未命中。档位经 `'off' | 'low' | 'high' | 'max'` 校验；路由声明的档位集合可读且不含目标档位时跳过切换；投影抛错一律视为"无法确认"并跳过，而不是冒险发送路由可能拒绝的档位。
- `tool_activate` 声明 `isConcurrencySafe: () => true`。宿主的分发器早已按该自报能力分类（`executionMode()`：只有精确 `true` 加入并发组，其余 exclusive 并形成栅栏，结果按提交顺序提交），而本 preset 此前 0 处声明，自有工具全部退化为独占。该处理器只读事件流并返回报告，激活本身由运行时为此调用落下的 `tool/call` 事件承载，因此并发安全。
- 仅一项能力确需 DSH 核心而非在本仓库实现，记录于 `docs/liangshen-v41-flash-optimization.md` 第 8 节：`namespace::function` 工具映射（`dsh-tools` 注册表与 wire 序列化）、按 plan-mode 动态调节的 `reasoning_effort`（`dsh-llm` 请求组装钩子）、工具分发引擎的读并发/写串行栅栏。

## Testing

- tool-catalog 测试钉住三种呈现模式、`both` 下同驻的 `run_code`、缺少 code runtime 时的一次性降级告警、旧键映射告警与 `anchorTools` 退役告警。
- 分页行为钉住模式匹配、被扣留工具不进 wire、目录中的命名空间摘要、`tool_activate` 从下一请求起挂载、三个激活命名空间的 LRU 驱逐，以及跨压缩与恢复从持久事件流重建激活状态。
- minimal-prompt 测试钉住替换后的纪律文本、win32 临时 shell 行与 working-context 投射的可读门控；preset-composition 测试校验随包发布的 `agent.cordis.yml` 在新键下结构合法。
- 常驻预算守卫与目录分组各有覆盖：估算器对空面、不可序列化的畸形 schema 与四字符一 token 的换算；超限告警每次会话只发一次、未超限保持静默、提高阈值即静默，且非正阈值被配置校验拒绝。分组覆盖「已激活家族出现在其命名空间标题下且每个工具只出现一次」，以及未配置分页模式时不产生命名空间字段。
- 稳定前缀不变量有回归测试：改动工作区指令文件后，persona 与 plan-policy 段逐字节不变，只有 appended 段的变量值随之改变——这是编码器前缀 KV 缓存得以复用的前提。
- `reasoning-effort` 的测试钉住：阶段判定（plan/mode 事件优先，无事件时首轮视为规划）、按阶段解析档位、被提供的档位集合排除目标档位时不切换、已等于目标档位时**保持对象同一性**（不替换即不造成请求头快照抖动）、长执行段内多次请求持续保持同一性、投影抛错时保守跳过、配置档位非法值被拒，以及载荷缺少 agent 或会话折叠抛错时一律不使请求失败。
- 本次改动的仓库门禁为 `pnpm i18n:check` 与 `pnpm docs:check`。本次改动不包含付费 A/B：默认值依据官方已发表的脚手架横评，评测矩阵仍是未来任何统计结论的度量工具。

## Alternatives considered

- 保留锚定回合加第二回合 PTC 晋升。否决：官方脚手架横评把 PTC 排在原生极简面之后；回合边界跃迁每会话恰好使前缀缓存失效一次；晋升后 `run_code` 之外的每个工具都要付出生成 SDK 的语法与运行时代价。
- 退回封闭的 4 工具极简面。否决：MCP 服务与插件工具在物理上不可达——即使这能最大化闭卷基准分数，对真实工程会话也不可接受。
- 全量平铺原生清单（含外部 schema）。否决：静态 schema 面会挤占稀疏注意力索引，随清单增大降低工具选择精度；分页的存在正是为了让静态面保持小巧。
- 对所有非核心工具都做分页，而不仅是外部模式。否决：日常内置工具会在常规工作上付出一次激活往返；出厂默认只分页 `mcp__*` 式的外部工具——它们恰好是 schema 最重、使用频率最低的一类。
- 在 preset 内自行实现命名空间映射、动态推理努力度与分发栅栏。否决：三者都属于宿主拥有的接缝（工具注册表与 wire 序列化、请求组装、分发调度）；preset 侧的局部 fork 会复制宿主语义并与其他预设冲突。

## Consequences

- wire 不再在回合边界变化：persona 前缀与呈现在整个会话中保持稳定，注入目录只在真实工具面变化（分页激活、呈现变更或压缩遮蔽）时重发。
- 外部 MCP 工具保持可达且不再平铺 schema：以一行命名空间摘要宣告、按需挂载，同时最多三个分页命名空间激活。
- `run_code` 作为普通工具保留，承担计算密集型工作，而不再作为会话唯一传输通道取代原生交互。
- 声明在激活时以及每次已提交的设置写入后由随包的 `agent.cordis.yml` 重建，升级后新建的会话组合出新的 wire 行为；不再写入 harness home，早期修订持久化的历史保留其注入目录消息（`plugin` 来源 kind 不变）。
- 验证层级不变：真实推理探针不等于模式集成通过，更不等于统计提升；未来任何性能结论都经过记录基线的评测矩阵得出。
