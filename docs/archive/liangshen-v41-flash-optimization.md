# 梁神模式针对 DeepSeek-V4.1-Flash 的原生架构优化与重构方案

> 实施状态（2026-09-20 更新）：本方案已由 `dsh-liangshen` 全量落地——`presentation` 三态配置（**出厂默认 `both`**：原生清单与 `run_code` 同驻，原生直调优先、`run_code` 用于程序化批处理与并发扇出；缺 code runtime 时回退 `native` 并一次性告警）、旧键 `ptcPresentation` 映射并告警、`anchorTools` 首回合锚定退役、温和 Tool Paging **出厂开启**（`pagedToolPatterns: ['mcp__*']`、`tool_activate({ namespace })` 激活、LRU 上限 3、激活状态从持久事件流重建，压缩与恢复安全）、§4.3 persona 纪律（2026-09-20 文案再审：去掉诱发流水账推理的措辞，并发探索改为纯动作表述）、`tool-result-pruner` **4096/2048/1024**（守护稀疏索引槽位并保住错误尾部与退出码）、win32 临时 shell 纪律行、working-context 就近投射（plan-mode/活跃命名空间/进行中 todo/登记事实），以及两项 2026-09-20 新增：**运行时退化熔断器 `guard`**（双梯停摆检测：单步推理 ≥8000 字符零产出 1 步即触发 + 连续 4 步真实推理零产出慢烧触发，外加同参失败空转梯；每 episode 触发一次：注入熔断消息并把推理档位临时下调一档，无信号时从不改写请求——回应 DSH #5976，阈值按 V4.1 官方 MAX OUTPUT 384K 尺度校准）与**关键事实登记簿 `fact_register`**（登记硬约束/已确认决策/失败路径，随 working-context 行每步投射进局部注意力窗口——回应 V4.1 长会话遗忘）。§2.3 的命名空间呈现以预设内可实现的形式落地：已激活分页家族的工具在目录中归在 `namespace `<名称>` (activated):` 标题之下；§3.1 的常驻集预算以 `maxResidentTokens`（默认 **8000**，按 V4.1 的 KV 压缩重新校准——其 KV cache 为 V4-Flash 的 1/4，同样的 schema 负载只占 1/4 的稀疏索引槽位）落地为一次性告警守卫；§4.1 的输出纪律已作为 `Bounded Output` 一条写入 persona 本体；§4.5 的稳定前缀不变量由 `minimal-prompt` 的回归测试守住。§7.3（动态 reasoning_effort）经 2026-09-20 复核：常驻分档机制维持 2026-09-17 的删除决定，但**熔断触发的一次性降档**作为 guard 的动作恢复（见 `.agents/notes/implemented/simplification/2026-09-20-liangshen-guard-triggered-reasoning-stepdown.zh.md`）；§7.4（并发调度栅栏）经核实**均不属于上游需求**，已在 preset 内落地（`tool_activate` 与 `fact_register` 均声明 `isConcurrencySafe`）。仅 §7.1（`namespace::function` 映射）确需 DSH 核心支持：出站工具名须在 `dsh-tools` 的 schema 投影层改写，插件无法替换；插件侧只能做入站别名容错，收益有限，故不实现。**默认呈现由 `ptc` 改为 `both`**：原默认值是一次未测量的取舍，与 §1.2 引用的官方横评反向（ptc 在 DeepSWE v1.1 低 5.0、Terminal-Bench 2.1 低 4.8）；`both` 保留官方数据支持的原生面、同时让 `run_code` 作为特化计算出口同驻，目录文案明确「原生直调优先」。最终默认值由 §6 评测矩阵（`both`/`native`/`ptc` 三面）裁决，见 [liangshen-v41-community-feedback-update.md](liangshen-v41-community-feedback-update.md) §4。
## 1. 背景与现实工程痛点

### 1.1 历史成因与“PTC 假设”的破灭
梁神模式（`dsh-liangshen`）此前的核心机制为：首轮通过基础工具集（`[bash, str_replace_editor, exit_plan_mode, skill]`）进行 Native 原生锚定，第二轮起无条件或在满足条件后晋升为 PTC（Programmatic Tool Calling，代码运行模式，wire 上仅暴露 `run_code`）。

该架构最初成型于社区针对 DeepSeek 系列模型早期表现的非官方假设，其核心逻辑假设：
1. 极简 Persona 能防止模型产生过度客套与注意力涣散；
2. PTC 模式允许模型编写一段程序串联执行多个工具，减少多轮对话往返与上下文 Prefill 开销；
3. 第一轮 Native 用于确立思考范式，第二轮 PTC 用于释放复杂代码编排能力。

### 1.2 官方基准数据与现实工程的断层
2026 年 9 月公布的《DeepSeek-V4.1-Flash Technical Report》以及后续工程实践揭示了两个相互割裂的客观事实：

1. **官方基准下的 PTC 性能劣化**：
   在官方严格受限的 Agent Scaffolds（智能体脚手架）横向评测中（N=8/N=3，Max Reasoning Effort=100，1M 上下文）：
   - **DSH Minimal（官方纯极简原生）**：DeepSWE v1.1 为 **72.6%**（最优），Terminal-Bench 2.1 为 **90.6%**（最优）；
   - **DSH Standard（标准原生）**：DeepSWE v1.1 为 70.5%，Terminal-Bench 2.1 为 85.8%；
   - **DSH PTC（代码运行模式）**：DeepSWE v1.1 跌至 **67.6%（大幅下滑 5.0%）**，Terminal-Bench 2.1 为 **85.8%（下滑 4.8%）**。
   官方数据直接证实：在代码 Agent 场景中，PTC 模式因语法复杂度、Promise 包装、错误传播链延长等问题，实际表现显著劣于官方推荐的原生模式。

2. **现实工程不可退回“封闭四工具极简”**：
   官方 Minimal 之所以能拿到 72.6% 的高分，是因为闭卷 SWE-bench 测试题目单一（在隔离仓库内跑 pytest 并改写单文件），全场仅暴露 2~4 个工具，模型不存在选错工具的概率。
   然而，在真实工程中，开发者严重依赖丰富的扩展生态：
   - **外部 MCP 服务**（如 `mcp__codegraph__*` 代码图谱、数据库、GitHub、浏览器）；
   - **内置功能插件**（如 `dsh-task-board` 任务板、`dsh-git-graph` 图谱、`dsh-ssh` 远程会话）；
   - **动态技能库**（`dsh-skill-explorer`、自定义 Skills）。
   若退回“死守 4 工具的纯极简”，将导致所有外部 MCP 和插件在物理上不可达；若盲目将数十个工具全部平铺丢入 Native Wire，又会引发严重上下文膨胀。

---

## 2. V4.1-Flash 底层物理机制深度剖析

结合 V4.1-Flash 的网络结构、开源代码实现（`encoding.py`）与注意力论文，重构必须建立在以下底层物理事实之上：

### 2.1 注意力衰减的物理根源：CSA2 压缩稀疏注意力（890 Bytes/Token）
DeepSeek-V4.1-Flash 相比前代大幅削减了 KV 缓存体积，采用了 **CSA2（Compressed Sparse Attention 2）** 机制：
- **超窄局部滑动窗口（Sliding Window）**：局部密集注意力窗口仅有 **128 个 raw tokens**；
- **极度受限的稀疏索引槽位**：全局注意力依赖稀疏索引器，每个 query 仅检索 **Top-K = 512 个压缩块（Compressed Entries）**；
- **两级分层索引器（Two-Level Indexer）**：解码器深层的检索候选池被第一层 Full 模式索引器所筛选的候选池强行锁定。

**工程危害**：
若朴素地将 30~50 个 MCP/插件工具平铺注入 Native Wire，每个工具包含冗长的 JSON Schema，工具定义自身即可消耗 1.5 万至 3 万 tokens。在 CSA2 只有 512 个 Top-K 索引块的物理约束下，**静态工具定义会直接霸占绝大部分稀疏索引槽位**。导致实际对话中的关键架构指令、早期业务约束在深层解码中物理脱离上下文，引发断崖式的注意力丢失。

### 2.2 思维死循环机理：RL 奖励偏置与缺乏事实输入的封闭死锁
- **自省反思强奖励（Self-Correction Bias）**：V4.1 继承了 R1 和 V3.2 的强化学习训练范式，模型在思考区（`<think>`）推导时对“自我怀疑、重新推导”存在很高的正向奖励偏置；
- **封闭推导死锁**：在 Native 交互中，当工具返回非预期结果（如找不到符号、命令报错）时，模型容易在思考区试图凭空猜测系统状态。由于思考区是封闭系统，无法获得新事实，模型陷入重复假设与推翻的逻辑闭环；
- **高档位 reasoning_effort 倒逼长思维**：V4.1 引入了 1-100 的数值化推理努力度参数（默认 high: 75 或 max: 100）。在常规的单步操作（如读一个文件、检查分支）中，过高的推理预算强迫模型必须产生大量思考 token，从而诱发无意义的长考与死循环。

### 2.3 官方原生资产：Tool Namespaces 机制
在官方开源的 `encoding.py` 中，DeepSeek 明确内置了工具命名空间规范：
```xml
<｜DSML｜ calls>
<｜DSML｜ invoke name="namespace::function">
<｜DSML｜ parameter name="param" string="true">value</｜DSML｜ parameter>
</｜DSML｜ invoke>
</｜DSML｜ calls>
```
模型在训练阶段天然拟合了基于 `namespace::function` 的结构化多工具调用，具备按域收敛工具选择的内生认知能力。

---

## 3. 终极重做方案：Next-Gen「分级命名空间 + 渐进式发现」原生架构

新架构彻底告别二极管思维（既不倒退至封闭的 4 工具 Minimal，也不逃避至脆弱的 PTC 脚本执行），建立一套以 Native DSML 为主干、分级命名空间隔离、按需渐进激活的工业级架构：

```
+---------------------------------------------------------------------------------+
|                      DeepSeek-V4.1-Flash Native 执行总线                        |
+---------------------------------------------------------------------------------+
       |                                                    |
       v                                                    v
[1. 常驻核心开发工具集 (Core Native Set)]       [2. 外部 MCP 插件原生命名空间映射]
- shell::bash                                  - codegraph::explore
- fs::read / edit / write                      - github::create_issue
- search::glob / grep                          - ssh::exec
- agent::ask_user / todo_write                 - docker::ps
  (约 1500 tokens, 守护 CSA2 512 索引槽位)         (通过 namespace::tool 隔离)
       |                                                    |
       +----------------------------------------------------+
                                 |
                                 v
                 [3. 低频/海量工具的“渐进式发现” (Tool Paging)]
                 - 上下文维持极简的一行能力目录 (Tool Catalog)
                 - 按需调用 tool_activate 挂载目标命名空间
                                 |
                                 v
                 [4. PTC 的正确降级定位：特化计算技能 (run_code)]
                 - 降级为普通原子工具，不作主交互管道
                 - 专用于海量只读并发、高密度数学/数据算法演算
```

### 3.1 核心层级设计

#### 分层一：常驻核心 Native 工具集（Core Working Set）
保留最高频、通用的核心系统工具常驻 wire，全生命周期保持 Native 呈现：
- 文件操作：`read`, `write`, `edit`
- 检索感知：`glob`, `grep`
- 终端运行：`bash`
- 任务控制：`ask_user_question`, `todo_write`
- **控制预算**：核心工具的 Schema 严格控制在 1500 tokens 左右，确保不会冲击 CSA2 的 512 个 Top-K 索引池，同时满足 90% 的基础开发需要。

#### 分层二：外部 MCP 插件与扩展工具的“命名空间原生映射”
彻底废除在 `run_code` 内部通过 TypeScript SDK 代理调用 MCP 的扭曲做法。将注册的 MCP 服务直接通过官方规范映射为命名空间工具：
- CodeGraph MCP 映射为：`codegraph::explore`
- Git 扩展映射为：`git::graph`, `git::commit`
- SSH 插件映射为：`ssh::connect`, `ssh::exec`
- **收益**：模型输出天然符合其 RL 对齐的 `<｜DSML｜ invoke name="codegraph::explore">` 语法，享有原厂级参数校验与精准调用。

#### 分层三：海量 MCP/扩展工具的“按需渐进式激活（Progressive Tool Activation）”
当开发者接入了数十个外部工具时，**禁止将所有 Schema 一股脑注册进 wire**：
- **Catalog 摘要索引**：在会话上下文中注入紧凑的工具目录（每个工具仅保留名称与单行摘要，占几百 tokens）；
- **动态激活**：引入轻量内置工具 `tool_activate({ namespace: "..." })`。当任务需要操作特定领域（如 Kubernetes 编排或数据库操作）时，模型显式激活该命名空间，后续轮次的 wire 才挂载该命名空间的完整 Schema；
- **收益**：彻底斩断 Schema 膨胀，把上万 token 的噪音压制到几百 token，从物理上保全 CSA2 的注意力槽位。

#### 分层四：PTC 的正确定位——从“主执行通道”降级为“特化计算工具”
- 彻底取消会话级 PTC 切换（移除强制 `presentAs('ptc')`）；
- 将 `run_code`（或 `code_eval`）保留为一个**普通的常驻 Native 工具**挂载在 wire 上；
- **日常交互**：文件修改、命令执行、MCP 查询均直接使用 Native 工具；
- **特化场景**：只有当面对需要本地运行高密度算法推演、大批量文本正则过滤或多维矩阵计算时，模型才主动调用 `run_code` 工具编写并执行脚本；
- **收益**：既保留了 Native 单步探索的稳健性，又保留了代码执行器的算力支持。

---

> 原有的「分层五：原生 DSML 多步并发」已删除：多调用并发属宿主的调度职责（见 §7.4，未实现），preset 侧没有对应实现；且出厂默认为 `ptc`，会话主路径上不存在「模型在单回复中直接输出多个原生 invoke」的场景。


## 4. 配套上下文工程与防衰减措施

为了彻底解决非 PTC 原生交互下的“思考死循环”与“长程注意力衰减”，方案配套实施以下关键配置：

### 4.1 激进修剪历史工具输出（守护 512 索引槽位）
在 `agent.cordis.yml` 的 `compaction` 组中，调整 `tool-result-pruner` 策略：
```yaml
- id: tool-result-pruner
  name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
  config:
    thresholdChars: 4096      # 降低触发阈值，严防大文本霸占 index_topk
    headChars: 1500           # 保留有效头部
    tailChars: 500            # 保留退出码或结尾总结
```
工作纪律硬性约束：禁止在 bash 中裸执行产生海量日志的命令，必须结合 grep/head/tail 进行流式管道过滤。

### 4.2 末端滑动窗口就近状态投射（Recency Projection）
利用 V4.1 物理上绝对命中的 128-token 局部滑动窗口，在 pre-step 阶段于最新消息尾部注入极简状态快照：
```text
[Working Context: Step 3/5 | Current Goal: Fix auth logic | Active Constraints: Strict TypeScript, no external deps]
```
绕过 CSA2 远端两级索引过滤，达成 100% 的硬性注意力直达。

### 4.3 重塑 Persona 的“行动触发与反思熔断准则”
重构 Persona 内置工作纪律，明确硬性终止符：
```text
You are a helpful software engineer assistant.

- Thinking Disruption: Do not repeat reasoning on the same hypothesis more than twice. If necessary facts are missing, immediately close </think> and call native inspection tools (read, grep, bash) instead of speculating in thought.
- Action-Oriented: Thinking must focus solely on determining the next concrete operation. Do not mentally pre-rehearse full code implementations. All correctness verification must be conducted against actual tool outputs during the execution phase.
- Development Standard: Follow YAGNI and the PDCA loop. Each step verifies a single assumption. Do not write redundant comments.
```

### 4.4 阶梯化调节 API reasoning_effort
利用 V4.1 Flash 支持的 1-100 数值化推理预算：
- **规划与架构设计阶段（Plan Mode / Task Init）**：保持 `reasoning_effort: 75`（或 80），赋予充足的全局推演空间；
- **常规工具执行阶段（Execution Turns）**：将 `reasoning_effort` 降级为 **`40 ~ 50`（或 "low" 级别）**；
- **效果**：剥夺单步工具调用（如读文件、跑测试）时模型强行长考的 token 空间，彻底从根源消除低级死循环。

### 4.5 严格维持 Causal Encoder-Decoder 前缀 KV 缓存零抖动
保持极简 Persona、以及 `system-prompt` 模式下内置的 `workspace-instructions`（`AGENTS.md` 链）的逐字节绝对稳定，确保 CED 编码器隐藏状态到解码器全局 KV 缓存的 100% 静态命中，消除前缀变化引发的稀疏索引抖动。

---

## 5. 架构演进与配置变更对照表

| 架构维度 | 当前状态（原梁神模式） | 新架构（重做方案） | 核心解决问题 |
| :--- | :--- | :--- | :--- |
| **主通信协议** | 第 2 回合强制切 PTC (`run_code`) | 全生命周期 Native DSML 通信 | 消除 PTC 带来的 5% 性能滑坡，回归原厂对齐 |
| **外部 MCP 适配** | 脚本内动态无类型 SDK 调用 | 原生命名空间映射 (`namespace::tool`) | 优雅兼容外部 MCP，消除 JS 运行时语法错误 |
| **大规模工具管理** | 全部塞进 PTC SDK | 核心常驻 + 海量工具按需激活 (Tool Paging) | 阻断 Schema 膨胀，死守 CSA2 512 索引槽位 |
| **代码执行器定位** | 独占会话的唯一主管道 | 降级为普通原子工具 (`run_code`) | 保留复杂计算与并发脚本能力，日常无侵入 |
| **并发调用机制** | 在 `run_code` 中写 `Promise.all` | 原生单回复多个 `<｜DSML｜ invoke>` | 零语法开销的原生高效并发 |
| **工具结果修剪** | 8192 字符宽松截断 | 4096 字符激进修剪 (head: 2048, tail: 1024，保住错误尾部与退出码) | 避免工具日志污染两级稀疏索引器 |
| **思考循环控制** | 抽象的 avoid repetitive loops | 动作熔断三原则（反思超 2 轮即刻闭合思考） | 阻断封闭推导死锁，强制交由环境验证 |
| **推理努力度** | 全程固定高预算 (75/100) | 执行阶段 40~50，规划阶段保留 75 | 消除简单单步工具执行中的强行长考 |

---

## 6. 实施落地与验证计划

1. **Preset 改造（`agent.cordis.yml`）**：
   - 移除 `ptcPresentation: true` 配置，关闭 `tool-catalog.mjs` 的呈现切换逻辑；
   - 将 `run_code` 注册为普通 Native 工具行；
   - 调整 `tool-result-pruner` 修剪参数。
2. **工具适配层升级**：
   - 升级 host 工具注册与暴露层，输出符合 V4.1 规范的 `namespace` 结构体；
   - 接入 `tool_activate` 动态挂载机制。
3. **基准验证（A/B Testing）**：
   - 使用包内 `packages/dsh-liangshen/tools/benchmark-live-run.mjs`，通过种子任务集 `liangshen-v41-flash.json`，在统一基线下运行新方案与原方案的对比；
   - 通过 `benchmark-report.mjs` 检验独立任务完成率、超时率、token 与费用消耗，确保新方案在真实工程场景中稳健超越官方 Minimal 基准。

---

## 7. 方案关键工程补全细节（落地防踩坑指南）

为确保方案在真实复杂工程（包含数十个 MCP、多插件、跨平台系统）中 100% 稳定交付，必须补充以下五项关键底层实现规范：

### 7.1 命名空间双向映射与符号路由契约（Symbol Routing & Mapping）
- **痛点**：模型在 DSML 中调用的是 `codegraph::explore`，而底层 Cordis 容器注册的原名通常是 `mcp__codegraph__codegraph_explore` 或 `plugin-tool`。若缺少精准的双向转译器，会导致模型调用遭遇 `Tool not found`；
- **实现契约**：
  在暴露给 V4.1 的工具转换层，建立确定性双向映射表：
  1. **注册投影（Schema Projection）**：
     - 若工具名形如 `mcp__<server>__<func>`，提取 `namespace = <server>`，`name = <func>`；
     - 若为内置核心工具，归入对应系统命名空间：`fs::read`、`shell::bash`、`search::grep`、`agent::ask_user`；
  2. **反向分发（Reverse Dispatcher）**：
     - 宿主拦截模型的 `<｜DSML｜ invoke name="namespace::func">` 调用，反向还原为内部注册表真实 ID 并执行，严禁向模型暴露内部下划线拼装的私有符号。

### 7.2 动态 Tool Paging 的 LRU 驱逐与压缩恢复（Compaction Recovery）
- **痛点**：若任务跨度极大，模型陆续激活了 10 个命名空间，工具 Schema 将重新面临膨胀并击穿 CSA2 稀疏索引；且在触发上下文压缩（Compaction）后，动态激活状态容易丢失；
- **实现契约**：
  1. **激活容量上限（Capacity = 3）**：动态挂载的外部命名空间最多同时保留 3 个活跃槽位，超出时基于 LRU（最近最少使用）自动冻结最早激活的命名空间，重新退回 Catalog 摘要状态；
  2. **压缩幂等恢复**：会话触发 Compaction 时，将当前仍处于活跃状态的命名空间列表固化进压缩快照摘要，恢复后自动重新挂载，无需模型重新摸索。

### 7.3 动态 reasoning_effort 的精准挂载锚点（Hooking Seam）
- **痛点**：如何让 API 的推理努力度（1~100）随会话阶段自动无缝流转；
- **落地挂载点（已核实可行）**：订阅宿主的 `agent/request` 水位事件——签名为 `(payload: { agent, turn, step, signal }, next)`，返回 `LlmCallConfig`，按 agent 作用域派发，插件可直接改写 `reasoningEffort`：
  ```typescript
  ctx.on('agent/request', async ({ agent, turn, step }, next) => {
    const config = await next()
    const planning = planModeActive(agent) || (turn === 1 && step === 0)
    return { ...config, reasoningEffort: reasoningEffortFor(planning) }
  })
  ```
  阶段判定识别三种情形，平滑切换且无需人工干预：**规划**（显式计划模式，或日志尚无模式记录时的首轮）取高档位（默认 `'high'`）；**复核**（一次失败的派发开启了区间，且此后尚无成功的派发关闭它）取复核档位（默认同规划档位，因为诊断失败与制定方案是同类工作）；**执行**（其余情况）取低档位（默认 `'low'`）。失败与成功配对成区间，是让「修复—验证」循环从失败到修复成功全程保持深档位，而不是每次工具调用都来回切换。

`reasoningEffort` 是 branded id，取值须来自部署已声明的档位集合而非任意数字（DeepSeek adapter 接受 `'off' | 'low' | 'high' | 'max'`，profile 可再收窄）。**关于缓存（更正）**：宿主把档位列为"可能影响缓存复用"的请求头状态，并把"哪些字段属于缓存纪元级别"写成尚未定论的 TODO；本仓库**没有**验证过档位变更对服务端前缀缓存的实际影响，因此此前"变更会使缓存前缀失效一次"的断言已删除。插件仍只在阶段边界切换、且仅在档位确实不同时才替换，把变更次数压到最低——这是无论服务端如何实现都安全的选择。

### 7.4 原生并发调用的“读并发 / 写串行”安全屏障（Concurrency Safety Barrier）
- **痛点**：模型在单个回复中输出多个 `<｜DSML｜ invoke>` 时，若多个写操作（如同时编辑同一文件的不同区域，或同时执行互相冲突的 bash 命令）并发运行，会导致严重的数据破坏与竞争条件（Race Condition）；
- **执行器安全栅栏（已由宿主实现，更正）**：**此前的"宿主未实现"判断有误**。`dsh-tools` 的 `executionMode()` 已按工具自报的 `isConcurrencySafe` 分类：只有精确返回 `true` 的调用加入并发组，其余一律 exclusive 并形成栅栏；开始严格按提交顺序、结果按 head-of-line 游标依序提交，`maxParallelSubCalls` 设为 1 即恢复严格串行（实现见 `packages/core/tools/src/index.ts` 与 Agent Note `2026-07-10-parallel-tool-call-execution`）。宿主工具（`read`、`read-image`、`web search/fetch`、`session-query`、`subagent`）已声明该能力；
- **preset 侧的实际缺口**：`dsh-liangshen` 此前 0 处声明，自有工具全部退化为 exclusive。已为 `tool_activate` 声明（该处理器只读事件流并返回报告，激活本身由运行时为该调用落下的 `tool/call` 事件承载，因此并发安全）。
- **原方案设想的形态**（供参考，宿主已以更通用的方式覆盖）：
  - **只读调用群（read, grep, glob, codegraph）**：通过 `Promise.all` 纯并行调度，榨干 I/O 与并发性能；
  - **变动调用群（write, edit, bash）**：自动排入串行队列（FIFO Submission Order），顺序执行并依次捕获结果；
  - 返回时按调用顺序对齐整合进同一个 user message 的多个 `<tool_result>` 中。

### 7.5 跨平台终端状态非持久化适配（Windows Git Bash 容错）
- **痛点**：Linux/Darwin 下支持 PTY 跨调用持久终端（支持先 `cd` 后 `ls`），但 Windows 下受限于平台机制使用的是临时 Git Bash 子进程，进程结束状态即丢；
- **针对性工作纪律补充**：
  在 Windows 运行时环境下，动态向系统提示词追加单行平台纪律：
  > *“Current platform is Windows (Git Bash). Shell processes are ephemeral; environment variables and working directory changes do not persist across tool calls. Use compound commands (e.g., cd path && command) for chained operations.”*

---

## 8. 上游依赖（DSH 核心）

以下三项能力属于宿主（DeepSeek Harness 核心）的职责范围，本仓库不实现；本节记录其动机、所需改动面与现状。

### 8.1 工具命名空间映射（`namespace::function`）
- **动机**：V4.1 的训练分布天然拟合 `namespace::function` 结构（见 §2.3），把 `mcp__<server>__<func>` 形式的注册名投影为命名空间工具可提升多工具场景下的选择精度，并让分页激活以命名空间为自然单位；
- **改动面**：`@deepseek-ai/dsh-tools` 注册表与 wire 序列化——schema 投影（注册名 → `namespace` + `name`）与反向分发（模型调用 → 内部注册 ID）须由宿主统一提供，preset 侧自行 fork 会与其他预设的注册语义冲突；
- **现状**：未实现。梁神模式当前以平面注册名工作，`pagedToolPatterns` 与 `tool_activate` 的匹配单位是平面工具名前缀。

### 8.2 按 plan-mode 动态调节 reasoning_effort
- **动机**：§4.4 的双相推理节律（规划 75 / 执行 40~50）需要从请求组装管线读取 plan-mode 状态并写入请求参数；
- **改动面（更正）**：**此前的"属上游需求"判断有误**。宿主已提供插件可用的接缝：`agent/request` 是一个水位（waterfall）事件，签名为 `(payload: { agent, turn, step, signal }, next: () => Promise<LlmCallConfig>) => LlmCallConfig`，按 agent 作用域派发。DSH 自带测试即用例证：`ctx.on('agent/request', async (_payload, next) => ({ ...await next(), temperature: 0.5 }))` 可在插件内改写配置字段，回调同时可读到 `turn`/`step`。因此 preset 插件可以订阅该事件、从会话事件流折叠出 plan-mode 状态、返回改写后的 `reasoningEffort`，**无需修改 DSH 核心**；
- **现状**：**已实现**（`presets/liangshen/reasoning-effort.mjs`，挂载为 `reasoning-effort` 行，`planningEffort: 'high'` / `executionEffort: 'low'` / `reviewEffort: 'high'`），但由 `autoEffortByPhase` 开关把关且**出厂关闭**：关闭时插件不注册任何请求监听，模型选择器携带的档位原样生效；开启后从下一个阶段边界起接管。之所以默认关闭，是因为会话档位是选择器里可见且显式的用户选择，静默覆盖会让它看起来像坏了。只在 plan-mode 边界切换：该字段参与请求头快照并决定缓存复用，逐回合翻转会为省推理 token 而每回合付一次缓存未命中。档位取值在加载时经 `'off' | 'low' | 'high' | 'max'` 校验。**插件刻意不在请求时校验路由是否提供该档位**：宿主的 llm 服务没有暴露"某模型已声明的档位集合"查询（公开面只有 providers / models / prepareCall 等），因此任何此类守卫都永远不会触发，只会暗示一个并不存在的检查。路由拒绝所配档位会以其自身的调用失败显现，由运维收窄配置。

### 8.3 分发引擎的读并发 / 写串行栅栏
- **现状**：**不属于上游缺口**（更正）。宿主早已实现该栅栏：`dsh-tools.executionMode()` 按每个工具自报的 `isConcurrencySafe` 分类，只读调用并发、变动调用独占成栅栏，结果按提交顺序提交。preset 能施加的影响是**为自己的工具正确声明该能力**，已在 §7.4 落地（`tool_activate` 声明为并发安全）。

