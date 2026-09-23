# 梁神模式面向 DeepSeek-V4.1 的调整增补（社区反馈 × 官方新数据筛选版）

> 本文是 [liangshen-v41-flash-optimization.md](liangshen-v41-flash-optimization.md) 的**增量更新**，不重复其结论；它把 2026-09-10 V4.1-Flash 发布后的社区实测反馈与官方模型卡/技术报告新数据并入，回答一个问题：**当前出厂的梁神模式还应改哪里，才能让 DSV4.1 在真实工作中更高效、更强大。**
>
> 阅读方式：§1 是证据清单（什么可信、什么存疑）；§2 是「保留 / 推翻 / 新增」的筛选结论；§3 是按优先级排序的改动清单（P0 立即可做 → P2 需要验证）；§4 是验证计划。

---

## 1. 证据清单（按可信度分级）

### 1.1 A 级：官方数据（模型卡 / 技术报告 / API 文档）

| 事实 | 数值 | 对梁神的意义 |
| :--- | :--- | :--- |
| 架构 | Causal Encoder-Decoder：prefill 激活 8B、decode 激活 16B；KV cache 890 B/token（V4-Flash 的 1/4） | 输入重的 agent 负载成本骤降；梁神「常驻 schema 预算」的物理依据仍在，但**预算可以重估**（见 §3 P1-3） |
| 训练 | 45T token 从头预训练；后训练 SFT → RL → OPD，**核心变化在数据管线：大规模自动合成 agent 任务/环境 + 渐进式 rollout 扩展** | 模型对「极简原生工具面」的拟合是 RL 数据喂出来的，不是猜测；这解释了 scaffold 横评的方向 |
| 官方 scaffold 横评（同模型、N=8/N=3、max effort、1M 上下文） | DeepSWE v1.1：mini-SWE 74.2 > **DSH Minimal 72.6** > DSH Standard 70.5 > Claude Code 69.8 > **DSH PTC 67.6**；TB 2.1：DSH Minimal 90.6 > mini-SWE 90.3 > Claude Code 88.0 > DSH Standard/PTC 85.8 | ① **V4.1 上 Minimal ≥ Standard > PTC**；② 横评最优其实是 mini-SWE 而非 DSH Minimal——差距在 harness 细节，不在「极简」本身；③ PTC 垫底且差距（-5.0/-4.8）与 V4 时代一致，**「梁神出厂默认 ptc」是与官方数据反向的默认值**（旧方案 §1.2 与状态块已自承未测量） |
| 推理档位成本 | effort 25→100：DeepSWE 66.0→74.2、TB 2.1 82.4→90.6，输出 token ~2.5×；**60–80 已恢复大部分精度，最后到 100 让轨迹变长 1.6–1.8×** | 「全程 max/high」是烧钱档位；梁神的分档思路（规划高/执行低）方向正确，且**多了官方依据把默认档压到 60–80 区间**（见 §3 P1-2） |
| 长上下文口径 | 官方 code-agent 评测统一用 1M 窗口；V4.1-Base 的 LongBench-V2 45.2 仍低于 V4-Pro-Base 51.5 | 1M 是「能用」不是「记得住」；窗口拉长后远端信息仍依赖稀疏索引召回——梁神的 working-context 就近投射与激进修剪**仍然必要** |
| 弱项（官方自认） | TB 3.0 30.0、TB 4.0 31.2、HLE 36.8，明显落后 Opus-5.0；HLE w/tools 63.9 追平 | 前沿长链路任务（TB3/4）恰是真实工程形态；**模型越弱的前沿任务越依赖 scaffold 的防退化与事实闭合纪律**——这是梁神的发力点 |
| 参数面 | temperature=1.0、top_p=0.95（官方 agentic 评测统一口径）；reasoning_effort 连续 1–100 | 官方评测即高温采样；不要在 preset 里偷偷降温，否则偏离训练/评测分布 |

### 1.2 B 级：社区高一致反馈（多源交叉，方向可信、幅度存疑）

| 反馈主题 | 代表来源 | 与梁神的映射 |
| :--- | :--- | :--- |
| **V4.1+DSH 真实工作「基本没法用」级抱怨** | DSH Discussions #6855（一天实测后集中爆发的问题清单）；r/DeepSeek「coding 质量配不上速度」 | 官方基准（TB2.1 90.6）与真实体感割裂——割裂点正是 scaffold/配置层，即梁神的战场 |
| **思考退化 / 零产出死循环（长上下文 + max effort）** | DSH #5976：v4.1-flash 在超长上下文 + max 下陷入「自我催促式空转」，**同配置 v4-flash 3083 步未复发**；结论指向模型侧生成退化，但暴露 guard 层缺口「可被插件补上、无需动 core」 | 梁神 persona 的「反思熔断」是纪律层；**缺的是运行时熔断器**（§3 P0-2）：#5976 证明纯纪律挡不住模型侧退化 |
| **工具调用死循环 / 烧 token，降档即缓解** | r/DeepSeek 1whgo3e：thread 失控后把 reasoning effort 从 max 降下来即恢复；与官方档位成本数据同向 | 直接支持把执行档压进 60–80 甜区、并把「死循环期间自动降档」做成运行时动作（§3 P0-2 + P1-2） |
| **reasoning_content 退化（We need…/I need… 流水账式推理）** | DSH #6509：疑似身份/系统提示改变推理模式；#5971：reasoning_content 内容本身退化 | 指向**系统提示词的身份声明会影响 V4.1 的推理形态**——梁神坚持极简 persona 的方向被间接印证，但 persona 每条纪律文案都应接受「是否诱发流水账推理」的审视（§3 P1-4） |
| **长对话「忘事」** | r/DeepSeek 1wlssvo：对话变长后持续丢失上下文 | 与 §1.1 长上下文口径互证：稀疏索引架构下远端召回本就打折；**working-context 就近投射要升级为「关键事实登记簿」**（§3 P1-1） |

### 1.3 C 级：单源或无法交叉核实的反馈（仅作诊断线索）

- #6855 正文逐条问题清单（全文抓取被反爬拦截，仅确认「一天实测后认为基本没法用」的总基调与若干标题级信息）；
- 「写作质量下降」「角色扮演崩坏」等与非 coding 场景相关的抱怨——与梁神无关，不采信；
- 「V4.1 快 3 倍、省 43% token」的社区对照跑（deepseekagent.io 转述）：**该跑未完成全部子任务，完成度不对等，不能当收益证据**。

---

## 2. 筛选结论：保留什么、推翻什么、新增什么

### 2.1 保留（新证据反而加强）

1. **温和 Tool Paging + tool_activate + LRU 上限 3**：B 级「忘事」与 A 级稀疏索引架构双重背书；唯一要改的是把它**重新打开**（现出厂 pagedToolPatterns 为空数组，等于关闭了方案的核心机制，见 §3 P0-3）。
2. **反思熔断 / 行动导向 / YAGNI·PDCA 的 persona 纪律**：#5976 的死循环形态正是「封闭推导无新事实」，纪律方向正确（但不够，见 §2.3-1）。
3. **working-context 就近投射**：远端召回打折是架构事实，末端窗口是确定性命中。
4. **不追踪 namespace::function 映射**：无新证据表明 V4.1 的 DSML 训练分布要求它；上游未提供前维持现状。

### 2.2 推翻或修正（与旧方案/旧默认值冲突）

1. **「出厂默认 ptc」应当终结**。官方横评在 V4.1 上复测仍是 Minimal/Standard 优于 PTC；旧方案文档自承该默认值「未测量、与所引数据反向」。**修正方向：默认改为 both**——原生清单在 wire 上可直调（保留官方数据支持的面），run_code 同驻作为特化计算/并发批处理出口。这比旧方案设想的纯 native 更稳：both 下原生调用承载日常工作、PTC 只在模型主动选择时介入，切换成本最低且可逐会话回退；最终默认值由 §4 的三面 A/B 裁决。
2. **「执行档 = low」的旧设想需要上修**。V4.1 官方数据把甜区标在 60–80；low 档在社区反馈中与「懒惰、忘指令」体感相关（C 级，谨慎）。修正：执行档默认进入 **high（≈75）甜区**，规划/复核档维持 high，仅在熔断器检测到死循环信号时临时降档（§3 P0-2/P1-2）。
3. **pruner 旧账仍在**：出厂 8192/4096/1024 与方案 4096/1500/500 不一致。A 级 KV 压缩证据支持激进修剪，但 #6855 类「没法用」抱怨提示**过度修剪会丢关键错误尾部**。修正取中间档 **4096/2048/1024**，并把「退出码 + stderr 尾部」列为不可修剪保留区（§3 P0-4）。

### 2.3 新增（旧方案没有、证据直接指向）

1. **运行时退化熔断器（circuit breaker）**：#5976 的核心教训是「模型侧退化时，纪律与 persona 都失效，唯一有效的是外力中断」。preset 内可实现：订阅回合事件，检测「连续 N 个回合零工具调用且思考 token 超阈」或「同一工具以同一参数连续失败 M 次」→ 注入熔断消息 + 临时把 reasoning effort 降一档 + 可选暂停循环交还用户。**本次优先级最高的新增项。**
2. **关键事实登记簿（Fact Ledger）**：针对「忘事」，working-context 目前只投射 plan-mode/命名空间/todo；升级为允许模型经专用轻量工具把「用户硬性约束、已确认的架构决策、失败过的路径」登记为单行事实，就近投射、随事件流重建。物理依据：末端局部窗口是 V4.1 唯一确定命中的远端。
3. **思考形态健康检查（轻量）**：#6509/#5971 提示流水账推理可观测。无需解析推理内容（也拿不到），但可统计「回合思考长度/产出比」的滑动均值，异常时并入熔断器信号。

---

## 3. 改动清单（按优先级）

### P0 — 立即可做（纯 preset 内，证据闭合）

| # | 改动 | 依据 | 落点 |
| :- | :--- | :--- | :--- |
| P0-1 | **默认 presentation 改为 both**（ptc → both），native/ptc 保留可选 | §1.1 scaffold 横评；旧文档自承默认值未测量 | [index.ts](../packages/dsh-liangshen/src/index.ts) 的 DEFAULT_PRESENTATION、schema 默认、设置卡默认值；同步两份文档状态块 |
| P0-2 | **运行时退化熔断器 v1**：检测连续零产出长思考回合、同参数重复失败；触发时注入熔断提示并临时降档 | #5976（模型侧退化需外力）；r/DeepSeek 降档缓解 | 新行 guard.mjs（订阅回合/派发事件，只读事件流，经 agent/request 水位降档） |
| P0-3 | **恢复温和分页为出厂开启**：pagedToolPatterns 出厂值 ['mcp__*']（现为 []） | §1.1 稀疏索引架构 + §1.2「忘事」 | [agent.cordis.yml](../packages/dsh-liangshen/presets/liangshen/agent.cordis.yml) tool-catalog 行（sync 覆盖源在包内出厂值，需一并改） |
| P0-4 | pruner 调整为 **4096/2048/1024**，stderr/退出码尾部不可修剪 | §2.2-3 折中 | agent.cordis.yml compaction 组 |

### P1 — 本周可做（preset 内，需配套测试）

| # | 改动 | 依据 | 落点 |
| :- | :--- | :--- | :--- |
| P1-1 | **Fact Ledger**：working-context 扩展「登记的关键事实」字段（事件流折叠，模型经专用轻量工具登记/撤销） | §1.2 忘事 + §1.1 末端窗口 | [working-context.mjs](../packages/dsh-liangshen/presets/liangshen/working-context.mjs) + 新 fact-ledger 行 |
| P1-2 | **effort 分档重标定**：规划 high / 执行 high 甜区（非 low）/ 复核 high；死循环信号触发临时 -1 档（P0-2 驱动）；autoEffortByPhase 仍默认关，但设置卡说明更新为「建议开启」 | 官方 60–80 甜区；low 档体感风险 | agent.cordis.yml reasoning-effort 行档位映射 |
| P1-3 | **常驻 schema 预算重估**：KV 压缩到 1/4 后，maxResidentTokens 6000 阈值上调并改为「超限时建议分页而非一次性告警刷屏」；重新测量出厂清单实际 token 数 | §1.1 架构数据 | tool-catalog 的 maxResidentTokens 逻辑 |
| P1-4 | **persona 文案再审**：逐条检查纪律文案是否诱发「We need…」式流水账推理；「并发探索」改写为纯动作表述（单轮内可发射多个独立调用），去掉任何引导叙述性推理的措辞 | #6509 身份提示影响推理形态（方向 B 级、幅度 C 级） | [minimal-prompt.mjs](../packages/dsh-liangshen/presets/liangshen/minimal-prompt.mjs) persona 段 |
| P1-5 | **both 模式 catalog 文案**：写明「原生直调优先、run_code 仅用于程序化批处理/并发扇出/重计算」，防止模型在 both 下把一切又塞回 run_code | scaffold 横评 PTC 垫底的机理（语法复杂度/错误链） | tool-catalog 的 catalog 渲染 |

### P2 — 需要验证后决定（先跑数据再改）

| # | 事项 | 验证方式 |
| :- | :--- | :--- |
| P2-1 | **both / native / ptc 三面 A/B**：官方横评没有 both 档，V4.1 上谁最优需自测 | [benchmark-live-run.mjs](../packages/dsh-liangshen/tools/benchmark-live-run.mjs) 种子集 liangshen-v41-flash.json，统一基线跑三面，比较完成率/超时/token/费用 |
| P2-2 | 熔断器阈值（连续回合数 N、重复失败数 M、思考 token 阈） | 用 #5976 形态的会话回放标定；宁可漏报不可误报——误中断真实长思考比死循环更伤体验 |
| P2-3 | 执行档最终默认值（60/70/75 或档位 id 映射） | 配合 P2-1 同矩阵跑档位维，取「完成率不降前提下的最小 token」点 |
| P2-4 | instructionSource 默认维持 host 还是转 system-prompt | A/B：长会话下 AGENTS.md 约束保持率 × KV 前缀命中率 |

### 明确不做

- **不做** namespace::function 映射（维持原判，无新证据）；
- **不动** shell/持久终端方案（V4.1 无相关反馈）；
- **不追**「把默认温度调低」——官方评测口径 temperature=1.0，偏离即离开训练分布；
- **不回退**到 4 工具封闭 Minimal（真实工作中 MCP 不可达的痛点未变）。

---

## 4. 验证计划

1. **先跑 P2-1 三面矩阵**（both/native/ptc × 固定种子集），用真实完成率裁决 P0-1 的默认值；若 both 不优于 native，P0-1 回退为 native。
2. **熔断器离线标定**（P2-2）：收集社区反馈形态的会话日志（零产出回合、重复失败序列），回放确定阈值。
3. **长会话遗忘测试**：构造 100+ 轮、含 3 个中途确立的硬约束的会话，开/关 Fact Ledger 各跑 3 次，统计约束遵守率。
4. **成本回归**：所有改动合入后，同一任务集对比改动前后总 token 与费用——目标是完成率不降、token 不升（effort 甜区 + 熔断器应带来净下降）。

---

## 5. 落地状态（2026-09-20，本文定稿时）

以下各项已合入 `dsh-liangshen` 并随包内 preset 发布（包内出厂值即事实源，设置界面可覆写 `presentation` 与 guard 开关）：

| 文档条目 | 状态 | 实现 |
| :--- | :--- | :--- |
| P0-1 默认 `presentation: 'both'` | 已落地 | [index.ts](../packages/dsh-liangshen/src/index.ts) `DEFAULT_PRESENTATION`、schema 默认、[agent.cordis.yml](../packages/dsh-liangshen/presets/liangshen/agent.cordis.yml) tool-catalog 行 |
| P0-2 运行时退化熔断器 | 已落地（阈值经 384K 尺度校准） | [guard.mjs](../packages/dsh-liangshen/presets/liangshen/guard.mjs)：双梯停摆检测——**单步暴走梯**（单条推理 ≥8000 字符且零产出，1 步即触发，对准 V4.1 官方 MAX OUTPUT 384K 的暴走形态，第一步就拦截）与**慢烧梯**（连续 4 步有真实推理但零产出，每步 ≥200 字符，接住小步空转闭环）；空转梯（同参连续失败 3 次）。触发后 pre-step 注入 `[Circuit Breaker]` 消息并经 `agent/request` 把推理档位下调一档（max→high→low，窗口 3 个请求）；无信号时纯 pass-through。**五个参数已进插件设置界面**：`guardEnabled`（总开关）、`guardSensitivity`（灵敏度三档：conservative×1.5 / balanced / aggressive×0.5，默认 balanced）、`guardStallReasoningChars`（单步暴走字符阈值**覆写**，默认随推理档位自适应：max 8000 / high 12000 / low 20000）、`guardGlobalStallCap`（慢烧连续步数**覆写**，默认 4）、`guardEchoFailures`（同参连续失败**覆写**，默认 3），随声明生效。阈值按 A+D 方案自适应：A 档按 reasoningEffort 走表，D 档灵敏度整体缩放，细调字段设了则以用户为准 |
| P0-3 分页出厂开启 | 已落地 | agent.cordis.yml `pagedToolPatterns: ['mcp__*']`，并补挂此前遗漏的 `tool-activate` 行 |
| P0-4 pruner 4096/2048/1024 | 已落地 | agent.cordis.yml compaction 组 |
| P1-1 Fact Ledger | 已落地 | [fact-ledger.mjs](../packages/dsh-liangshen/presets/liangshen/fact-ledger.mjs)（`fact_register` 工具，append/revoke 均从事件流折叠）+ working-context 渲染 `key facts:` 字段 |
| P1-2 effort 动态分档 | 以修正形态落地 | 不恢复常驻分档（维持 2026-09-17 删除决定）；熔断触发的一次性降档并入 guard，见 [Agent Note 修正案](../.agents/notes/implemented/simplification/2026-09-20-liangshen-guard-triggered-reasoning-stepdown.zh.md) |
| P1-3 预算重估 | 已落地 | `maxResidentTokens` 6000 → 8000（V4.1 KV cache 为 1/4，同负载占 1/4 索引槽位） |
| P1-4 persona 文案再审 | 已落地 | agent.cordis.yml persona 段：Thinking Disruption 去掉 `</think>` 标签引用、Action-Oriented 收紧、Parallel Inspection 改纯动作表述 |
| P1-5 both 目录文案 | 已落地 | tool-catalog `BOTH_PROGRAM_LINES` 首条改为「原生直调优先、`run_code` 仅用于程序化批处理/并发扇出/多步数据塑形」 |

### P2 验证操作手册（待运行）

1. **三面呈现矩阵（P2-1）**：`LIVE_VARIANTS` 已覆盖 `B`（出厂 both 基线）/`T`（ptc）/`N`（native）三面。运行：
   ```sh
   cd packages/dsh-liangshen
   node tools/benchmark-live-run.mjs --tasks tools/tasks/liangshen-v41-flash.json --groups B,T,N,M --repeat 3 --max-sessions 60 --budget-usd 5 --out .benchmark-results
   node tools/benchmark-report.mjs .benchmark-results
   ```
   裁决口径：若 `both` 完成率不优于 `native`，P0-1 回退为 `native`；若 `ptc` 意外反超，记录任务形态再议。
2. **熔断器阈值标定（P2-2）**：收集 #5976 形态会话导出（连续零产出长思考、同参重复失败序列），用 `node tools/analyze-session.mjs <session.jsonl>` 量出真实「停摆步长 × 思考字符」分布。出厂阈值已经 384K 官方 MAX OUTPUT 尺度校准（单步暴走 8000 字符 1 步触发 / 慢烧 4 步 × 200 字符 / 同参失败 3 次 / 降档窗口 3 请求 / 冷却 5 步），标定目标是**复核两梯在真实轨迹上不漏报、不误中断**——阈值直接在**插件设置界面**调整（`guardSensitivity` 一键缩放，或 `guardStallReasoningChars` / `guardGlobalStallCap` / `guardEchoFailures` 细调覆写，随声明生效），或经 `guard.mjs` 的 config 键（`stallSteps` / `stepDownRequests` / `refireCooldownSteps` 仅 preset 内可调），不要为标定改代码。
3. **长会话遗忘测试（P2-3 → 现为 Fact Ledger 验收）**：构造 100+ 轮、含 3 个中途确立硬约束的会话，开/关 `fact_register` 各跑 3 次，统计约束遵守率；预期开登记簿时约束在 `[Working Context: ...]` 行中全程可见。
4. **成本回归**：改动前后同一任务集对比总 token 与费用；目标完成率不降、token 不升（熔断器应在退化 episode 上净省 token）。

### 验证前注意事项

- 预设的 `presentation` 与 guard 开关改动由宿主提交后立即重新声明，对之后新建的会话生效，不需要重启服务；只有改动随包的 `agent.cordis.yml` 本身才需要重载插件（重启 DSH 服务，本仓库纪律：agent 不自行重启服务）；
- `guard` 的降档动作只覆盖 `max/high/low` 三档命名档位；数值档位（如 75）与 `off` 不干预；
- 已在用旧预设的会话不会自动获得 guard/fact-ledger——新建会话才组合新 preset。
---

## 附：证据来源

- 官方：[V4.1-Flash 发布公告](https://www.deepseek.com/en/news/deepseek-v4-1-flash/) · [模型卡（HuggingFace）](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash) · [API Change Log 2026-09-10](https://api-docs.deepseek.com/updates/)（含 scaffold 横评与档位成本口径）
- 社区：[DSH #6855「v4.1 flash + dsh 有很多问题」](https://github.com/deepseek-ai/deepseek-harness/discussions/6855) · [DSH #5976 超长上下文思考退化循环](https://github.com/deepseek-ai/deepseek-harness/discussions/5976) · [DSH #5971 reasoning_content 退化](https://github.com/deepseek-ai/deepseek-harness/discussions/5971) · [DSH #6509 身份提示影响推理模式](https://github.com/deepseek-ai/deepseek-harness/discussions/6509) · [r/DeepSeek：降 effort 解工具循环](https://www.reddit.com/r/DeepSeek/comments/1whgo3e/) · [r/DeepSeek：v4.1 忘事](https://www.reddit.com/r/DeepSeek/comments/1wlssvo/) · [r/DeepSeek：speed great, coding wasn't](https://www.reddit.com/r/DeepSeek/comments/1wgbwat/)
- 第三方整理：[deepseekv4guide 基准全表（含档位成本）](https://deepseekv4guide.org/guides/v4-1-flash-benchmarks) · [deepseekagent.io harness 对照](https://deepseekagent.io/guides/deepseek-v4-1-flash-vs-v4-flash-harness)（其引用的社区对照跑完成度不对等，本文不采信其收益幅度）
