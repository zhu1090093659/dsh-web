# Agent Note: 恢复四工具锚定与 PTC 语义修正

Status: implemented

部分取代[梁神模式改为只带 shell 的锚定与 PTC 晋升](2026-09-12-liangshen-shell-anchor-and-ptc-handoff.zh.md)：默认 `anchorTools` 恢复为 `[bash, str_replace_editor, exit_plan_mode, skill]`，保留 bash-only 作为配置实验；锚定回合覆盖首轮整个 user turn 而非单一请求；PTC 仅在实际成功时声称激活；注入 SDK 保留完整输入输出关键参数语义而非 200 字唯一契约；删除与 Minimal 完全一致、社区分数证明本版更好以及缓存等于行为等过度承诺。部分取代[梁神模式把 AGENTS.md 指令提升进系统提示词](2026-09-12-liangshen-agents-md-in-system-prompt.zh.md)的动态指令范围：说明后续将支持注册文件工具（含 `str_replace_editor`）及 PTC 内子调用触达的目录。交叉链接[把 Standard 目录分层到锚定回合之后](2026-09-11-liangshen-anchor-turn-staging.zh.md)与[极简 persona 加注入式标准工具目录](2026-09-11-liangshen-minimal-prompt-tool-catalog.zh.md)。由[请求面工具目录](2026-09-13-liangshen-request-surface-catalog-and-eval-tooling.zh.md)延伸：原生目录列出请求自身的 wire，PTC 下仍列经 SDK 可达的完整工具面，包内同时新增有界评测矩阵。部分被[V4.1 Flash 原生重构](2026-09-16-liangshen-v41-flash-native-rebuild.zh.md)取代：`anchorTools` 首回合收窄退役（设置则告警），`ptcPresentation` 由三态 `presentation` 键取代，默认 `both` 让完整原生清单与 `run_code` 同驻 wire；如实激活语义、请求面目录契约与三层验证标准继续有效。

## Problem

此前仅带 shell 的锚定设计（`anchorTools: [bash]`）过度收窄了首轮回合的工具面。在涉及文件读写、退出 plan mode 或技能查找的复杂首轮交互中，模型在 wire 上缺少 `str_replace_editor`、`exit_plan_mode` 与 `skill` 的原生 schema，增加了首轮调用的摩擦与出错概率。

同时，代码与文档积累了若干过度承诺与语义偏差：
1. 将首轮整个 user turn 误称为单次「首次请求」，混淆了多步交互的首轮回合行为；
2. 在第二回合无条件声称进入 PTC 模式，未考虑缺少 code runtime 或声明失败时的回退状态；
3. 将 SDK 注入契约简化为「200 字唯一契约」，忽视了 SDK 投影保留了完整的输入输出参数类型与调用语义；
4. 存在不实陈述：在内置工作纪律与工作区指令的前提下声称「与官方 Minimal 完全一致」、以社区个别分数证明本版普遍更优，以及将提示词缓存前缀命中等同于行为一致；
5. 安全模型未清晰界定宿主文件沙箱与 Windows Git Bash 限制（子进程缺乏 OS namespace 沙箱、状态不跨调用保留）；
6. 混淆了最小推理探针通过、模式集成通过与统计学效果提升的边界。

## Decision

梁神模式恢复首轮基础工具面，明确 PTC 激活与 SDK 参数语义边界，并重塑安全与验证标准。

- `presets/liangshen/agent.cordis.yml` 将出厂默认 `anchorTools` 恢复为 `[bash, str_replace_editor, exit_plan_mode, skill]`。保留 `[bash]` 的单 shell 配置实验，用户可通过配置直接启用，无需额外注册预设或变更注册表。
- 锚定回合明确定义为首轮整个 user turn（持久日志中少于两个 `turn/start` 事件），确保首轮多步执行均能稳定使用基础工具。
- PTC 模式仅在运行时实际声明成功时激活（`agent.ctx.tools.presentAs('ptc')`、存在 code runtime，且能读取到工具投影）。缺少任一条件时保持原生呈现并只告警一次：在投影不可读时声明，只会先收拢执行器再撤销，并在撤销途中丢失原生 wire。
- 注入目录描述的是该次请求 wire 实际携带的传输方式，而不是配置的意图：只有 wire 上确实出现 `run_code` 才附带 PTC 程序契约。声明无法在本次组装生效时（例如该部署没有可重入的组装入口），插件撤销声明并让执行器、wire 与目录三者保持一致，而不是宣告一个请求里并不存在的传输方式。
- 注入的工具目录保留注册表 SDK 投影的完整输入输出关键参数语义。`descriptionMaxLength: 200` 仅限制一行摘要文本长度，不裁剪关键参数结构。允许在呈现切换边界进行一次契约更新，不再坚持上下文绝对不变。
- 工作区子目录动态规则支持注册文件工具（含 `str_replace_editor`）及 PTC 内子调用触达的目录；不解析任意 bash/program 代码，不保证 shell 自行文件访问的自动发现。
- 工作区指令只在其内容确实已进入系统提示词时才被视为冗余：基线读取失败或为空时，宿主的 `agent-instructions` 消息原样透传，不因缺少 `source.baseline` 标记而被丢弃；只有提示词已覆盖且带标记的基线才压缩为一条提醒，未带标记的重复注入才被丢弃。
- 移除过度承诺：删除与 Minimal 完全一致、社区评测分数证明本版更好、以及缓存等于行为的陈述。
- 强化安全模型：明确阐述宿主文件沙箱策略约束与 Windows Git Bash 运行限制（非常驻进程、无 OS 沙箱隔离、禁止修改 custom-bash）。
- 建立三层验证标准：真实推理探针 ≠ 模式集成通过 ≠ 统计效果提升。

## Testing

- `tests/preset-composition.test.ts` 验证出厂 `agent.cordis.yml` 包含 `anchorTools: [bash, str_replace_editor, exit_plan_mode, skill]`，通过预设结构校验，并验证 bash-only 配置实验在无需修改注册表的前提下结构合法。
- `tests/tool-catalog.test.ts` 与 `tests/minimal-prompt.test.ts` 覆盖回合边界判定、签名渲染、优雅降级与指令预算裁剪。
- `tests/tool-catalog.test.ts` 钉住两条不变量：声明无法抵达本次 wire 时目录不宣告 PTC（旧实现的判据是恒真式，会在此处谎报），以及投影在会话中途失效时撤销声明并恢复原生 wire。测试桩据此如实建模——wire 由组装开始时的呈现方式决定，重组装复用调用方输入——因此重新组装路径本身也被覆盖。
- `tests/minimal-prompt.test.ts` 钉住指令冗余判据：提示词已覆盖且带标记的基线压缩为提醒并保留 `baselineIdentity`，未带标记的重复注入被丢弃，而基线未加载时消息一律透传。
- 验证流程明确要求区分最小推理探针、模式完整集成与统计学多轮评测。

## Alternatives considered

- 保持 bash-only 作为出厂默认。否决：首轮任务往往需要原地编辑、退出规划或加载技能，提供基础四工具可显著减少首轮试错成本。
- 单独注册一个四工具或单 shell 预设。否决：增加不必要的预设扩散；现有的 `anchorTools` 配置字段已能灵活覆盖不同实验需求。
- 坚持跨呈现边界上下文逐字节绝对不变。否决：在从原生切换到 PTC 模式时，允许更新一次包含完整 SDK 参数语义的契约说明，能提供更准确的工具指引。
- 解析任意 shell 脚本以自动发现嵌套 AGENTS.md。否决：静态解析任意 bash 极其脆弱且不可判定；发现范围限定为注册文件工具及 PTC 内部文件调用。

## Consequences

- 会话首轮交互可原生使用核心工具（`bash`, `str_replace_editor`, `exit_plan_mode`, `skill`），降低初始步骤摩擦。
- PTC 模式仅在条件满足时激活，避免在缺少 code runtime 的环境下产生错误契约。
- SDK 参数签名与语义在 TypeScript 程序中保持完整可执行性。
- 评测与验证建立在客观指标（完成率、工具错误、规则遵守、人工介入、消耗）之上，不再受单一探针或缓存命中的误导。
