# Agent Note: 梁神模式改为只带 shell 的锚定与 PTC 晋升

Status: implemented

部分被[恢复四工具锚定与 PTC 语义修正](2026-09-12-liangshen-anchor-tools-and-ptc-refinement.zh.md)取代：默认 `anchorTools` 恢复为 `[bash, str_replace_editor, exit_plan_mode, skill]`，保留 bash-only 作为配置实验；锚定回合覆盖首轮整个 user turn；PTC 仅在实际成功时声称激活；删除与 Minimal 完全一致、社区分数证明本版更好以及缓存等于行为等过度承诺。

部分取代[把 Standard 目录分层到锚定回合之后](2026-09-11-liangshen-anchor-turn-staging.zh.md)与[极简 persona 加注入式标准工具目录](2026-09-11-liangshen-minimal-prompt-tool-catalog.zh.md)的工具面部分：此前出厂锚定面为 `bash` 单工具，晋升面以 PTC 呈现工具。持久回合边界、扁平锚定收窄与注入目录机制继续有效。

## Problem

该模式把官方 Minimal 的一行 persona 作为整个系统提示词，但 wire 上一直是官方 Standard 的原生清单，只靠一个四 schema 的锚定回合（`bash`、`str_replace_editor`、`exit_plan_mode`、`skill`）分层。代价有两条。锚定回合为那些本来就能按名字调用的能力付了钱——执行按会话注册表解析（`dsh-tools` 的 `resolveExecution`），与请求里声明了哪些 schema 无关——而这三个多余 schema 却把第一次请求的工具面挡在本模式要复刻的单工具 Minimal 形态之外。而从第二个回合起，模型对工具的唯一描述就是注入目录：一串名称加一行摘要，完全不带参数形状，却坐落在一个庞大的原生清单之上——正是本模式所依据的社区评测里分数低于 Minimal 的那种面。PTC 的价值恰恰相反：一段程序完成一个意图，独立的只读调用用 `Promise.all` 并发（注册表上限默认 10）。而一个晋升后的会话，如果目录只有名称与签名、从未写明这套契约，仍会退化成一步一次调用，这份价值就没有兑现。

## Decision

锚定回合原生呈现且只带 `bash`；从会话第二个回合起，该会话的工具以 PTC 模式呈现。

- `presets/liangshen/agent.cordis.yml` 设 `anchorTools: [bash]` 与 `ptcPresentation: true`，并停用 `tool-workflow` 行、保留供 `ralph` 使用的 workflow 引擎行——这正是官方 `ptc` preset 唯一的清单差异，因为模型自著的组合面就是 `run_code` 本身。
- `presets/liangshen/tool-catalog.mjs` 接管整块分层工具面。它照旧把锚定回合的 wire 收窄到 `anchorTools`，并新增为该 agent 单独声明 PTC 呈现（`agent.ctx.tools.presentAs('ptc')`）。声明的触发点是回合边界上的会话事件——锚定回合的 `turn/end` 与第二个回合的 `turn/start`——而不是组装瀑布：harness 在运行 `system-prompt/assemble` 瀑布**之前**就已经收集完工具 provider，因此瀑布里做出的声明只能影响下一次组装，那会把收敛后的面推迟到晋升回合的第二步而不是第一次请求。组装监听器为「边界在被插件观测之前就已跨过」的会话（宿主在回合中途重启）重新声明一次；那里收敛会晚一次组装落地，之后保持。声明按 agent 加锁，上下文拿不到 code runtime（`ctx.get('codeRuntime')`）时跳过，声明被拒时保持原生 wire 并只告警一次——坏掉的可选路径只会降级，不会让会话的每个请求都失败。
- 目录条目取自注册表的 PTC 面（`ctx.tools.sdkSchemas(agent)`，其中不含保留的 `run_code`），按名称排序，每条渲染成紧凑的 TypeScript 风格参数签名加受长度上限约束的一行摘要，例如 `` - `bash({ command: string, timeoutMs?: number })`: Run commands in a bash shell``。渲染器覆盖标量、`const`/`enum` 字面量、`oneOf`/`anyOf` 联合、数组与内联对象字面量，其余一律降级为 `JsonValue`，且嵌套对象超过固定深度即停止展开，保证一个工具一行。注册表不提供 SDK 投影、或投影抛错时，条目回退到组装出的 wire schema，并只告警一次。
- 目录渲染是「条目列表 + 呈现计划」的纯函数，而条目本身不依赖当前请求带的是哪张面。因此锚定回合与晋升回合渲染出的文本逐字节相同：第一次发布跨过呈现切换继续有效，不触发重发。
- 目录结尾那段承载 `minimal-prompt` 连同 harness 自己的 `tools:sdk` 与 `tools:ptc-only` 段一并裁掉的程序契约与收敛规则：`run_code` 接收 `code`（async TypeScript 函数的函数体，只跑可擦除语法）与 `description`；一段程序完成一个意图，而不是一步一次调用；在程序里以 `await tools.<name>({ ... })` 调用工具，独立的只读调用用 `Promise.all` 并发（安全调用并发，变更调用按提交顺序独占执行）；调用失败以 `ToolCallError` 拒绝；只有程序 `return` 或打印出来的内容成为输出，因此结果要自己挑选；`run_code` 一旦在 wire 上就是唯一可直接调用的工具，而会话第一回合只带 shell。这段文字用本模式自己的措辞复述 harness 的用法说明，因此注入文本在呈现边界两侧完全一致；没有 code runtime、或设了 `ptcPresentation: false` 时，它随 PTC 声明一起省略。

## Testing

- `tests/tool-catalog.test.ts` 覆盖签名渲染器（标量、字面量、联合、数组、内联对象、嵌套深度上限、畸形输入）、条目排序与无名跳过、条目取自注册表面、只带 shell 的锚定回合（wire 收窄到 `bash`、不声明 PTC）、晋升回合在 `next()` 读取 wire 之前声明 PTC 且不动 wire、每个 agent 只声明一次、目录文本跨边界逐字节相同、空面的各种情形、针对持久日志的去重与重发规则，以及全部降级路径（无 code runtime、`ptcPresentation: false`、无 SDK 投影、投影抛错、会话没有 scoped tools 视图）各自的单次告警，以及程序契约在 PTC 下出现、在无 code runtime 或 `ptcPresentation: false` 时不出现。
- `tests/preset-composition.test.ts` 钉住出厂 `agent.cordis.yml` 里的 `anchorTools: [bash]`、`ptcPresentation: true` 与停用的 `tool-workflow` 行，并用仓库自有的 preset schema 校验。

## Alternatives considered

- 保留四 schema 原生锚定，只改注入目录的文本。否决：锚定工具面会停在四个工具，而 Minimal 形态只有一个；而且目录描述 `run_code` 时 wire 上却是原生 schema，等于描述了一套本会话并不存在的调用契约。
- 整个会话静态使用 PTC 呈现，像官方 `ptc` preset 那样。否决：第一次请求会带 `run_code` 而不是 `bash`，那恰恰是锚定要修正的面。
- 直接投递 harness 生成的 SDK 段全文（`@deepseek-ai/dsh-tools` 导出了 `renderToolsSdk`）而不是紧凑签名列表。对本案否决：注入消息是尾部上下文，而 SDK 全文还带固定用法散文、完整输出形状与嵌套对象类型，体积是签名列表的几倍；参数名与类型加上 harness 的结构化工具报错覆盖同样的信息。
- 直接注入 harness 渲染出的 `tools:sdk` 段全文，而不是复述契约。否决：它只在 PTC 上 wire 之后才存在，注入文本会在边界处变化并强制一次重发；它把本模式耦合到一个 harness 段名上，而该段消失只会静默降级；它还会带上紧凑签名已经覆盖的完整声明。
- 保持原生「名称 + 摘要」目录，同时让 wire 收敛为 `run_code`。否决：没有参数形状的名称列表在 TypeScript 程序里不可操作。
- 像 PTC 之前的版本那样从组装出的 wire 读取条目。否决：锚定回合的 wire 已收窄为 `bash`，晋升回合的 wire 又只有 `run_code`，第一次发布只会点名一个工具，边界处还得重发整份清单。
- 在组装瀑布里、`await next()` 之前声明呈现。经实测否决：构建 `assembly.tools` 的 provider 在瀑布之前就已运行，声明只能从下一次组装起生效，于是晋升回合的第一次请求会带着原生清单，而它的目录却声称 `run_code` 契约。这也正是锚定收窄不受该约束影响的原因——它变换的是已经构建好的组装结果。
- 把 PTC 声明放在 pre-step 决策里。同样因时序否决：pre-step 决策在自己的组装之后运行，收敛会晚一步落地。
- 像退役的 `tool-bootstrap` 那样在压缩后把会话重置为原生呈现。否决：本模式的边界是「会话的第二个回合」，从持久日志读取，压缩并不会造出需要重新锚定的「第二次首次请求」。

## Consequences

- 会话第一次请求逐字复刻官方 Minimal 面：persona 块加一个工具 schema（`bash`），而注入目录已经点名了晋升面。
- wire 每会话只在锚定回合边界变化一次，且这次变化现在是收敛为 `run_code` 的呈现切换，而不是清单替换。目录文本不随之变化，因此持久消息仍是每会话一条，外加压缩后的一次替换。
- 模型对晋升面的认知全部来自注入消息：参数签名与收敛规则，没有 harness 生成的声明（没有输出形状，也没有超出深度上限的嵌套展开）。参数写错会以 harness 的结构化工具报错暴露并自行纠正，代价是一次失败的调用。
- PTC 的提示本身——程序契约——也放在同一条注入消息里而不是系统提示词里，因此稳定前缀始终只有那一行 persona；这也意味着本模式的批量调用能力依赖于这条持久消息留在可见面上（压缩会重发它），并且它是模型了解该契约的唯一来源。
- `workflow` 不再属于本模式的工具面，与官方 PTC preset 一致；`ralph` 照常可用，因为只停用了工具行，没有停用引擎。
- 没有 code runtime、或设了 `ptcPresentation: false` 的部署保持此前的原生行为——第二个回合起 wire 上是组装出的清单，目录不带 `run_code` 契约——并只告警一次。
- 本模式不再声称锚定之后模型能直接调用任意已注册工具：PTC 呈现下只有 `run_code` 可以被点名，这正是注入消息写明的规则，也是本模式从注册表而非请求读取条目的原因。
- 晋升需要观测到一次边界事件：宿主重启后在回合中途恢复、插件从未见到该回合的 `turn/end` 或 `turn/start` 的会话，会有一次组装仍带原生清单，随后由组装期的重新声明收敛。模式的其他部分都不依赖呈现先落地——两种情况下目录文本完全一致。
- 描述四 schema 锚定、wire 上的 Standard 清单与「没有 PTC 切换」的 Agent Note 与 README 在同一次改动中更新；更早的记录作为仍然出厂的那套机制的依据继续保留。
