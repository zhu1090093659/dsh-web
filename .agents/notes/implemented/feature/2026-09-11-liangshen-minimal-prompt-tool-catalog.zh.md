# Agent Note: LiangShen mode as a minimal persona plus an injected standard tool catalog

Status: implemented

工具面部分被[只带 shell 的锚定与 PTC 晋升](2026-09-12-liangshen-shell-anchor-and-ptc-handoff.zh.md)部分取代：锚定面只有 `bash`，晋升回合以 PTC 呈现该会话的工具，因此目录列的是从注册表读取的参数签名，而不再是从 wire 读取的名称加摘要。指令部分被[把 AGENTS.md 指令提升进系统提示词](2026-09-12-liangshen-agents-md-in-system-prompt.zh.md)部分取代：agent-instructions 提示不再是默认行为。极简 persona、注入目录机制与消息来源的决定继续有效。目录索引范围部分被[请求面工具目录与评测工具](2026-09-13-liangshen-request-surface-catalog-and-eval-tooling.zh.md)部分取代：条目恰好描述当前请求开放的工具面，渲染文本不再跨呈现边界保持稳定。persona 文本与分层 wire 部分被[V4.1 Flash 原生重构](2026-09-16-liangshen-v41-flash-native-rebuild.zh.md)取代：工作纪律替换为行动触发式规则，锚定回合与第二回合 PTC 晋升退役；极简 persona 机制、注入目录机制与消息来源决定继续有效。

## Problem

梁神 preset 此前以「两阶段锚定」组合发布：第一次模型请求只暴露官方 Minimal 的两个工具，运行时上下文为空，消息来源被白名单裁剪；晋升要等首个 reasoning 块呈 minimal-like，并带四步兜底；随后 wire 切换为 PTC Mode（单一 `run_code` 工具）。这套机制的每一部分——锚定门控、bootstrap 输出预算封顶、延迟注入、压缩后回到受控阶段——都只是为了管理那次跃迁，而不是服务任务本身，而首轮为此付出的是只有两个工具。

一个线上缺陷把代价变得具体。phase-1 的提示词过滤器匹配的 section 名是 `deployment:persona` 与 `persona`，而当前安装的 SDK 把 persona section 注册为 `deployment:persona-prefix`（`PERSONA_PREFIX_SECTION`，`@deepseek-ai/dsh-system-prompt` 0.1.5-rc.1）。两者都不匹配，于是 phase 1 发出的是空系统提示词：整套设计赖以成立的锚定实际上并不存在，而且是静默失效。没有测试发现它，因为测试夹具与过滤器写的是同一个过期名字。

## Decision

preset 把官方 Minimal 的一行 persona——外加本模式的固定工作纪律与一行工作区目录方位信息——作为整个系统提示词，并从第一条用户消息起就把工具面作为上下文注入送达，而 wire 按回合分层：锚定回合（首个回合）原生保持官方 Minimal 面，从第二个回合起由同一个插件把该会话的工具以 PTC 呈现（[只带 shell 的锚定与 PTC 晋升](2026-09-12-liangshen-shell-anchor-and-ptc-handoff.zh.md)）。模型的能力事实以提示词尾部的消息送达，而不是以系统提示词散文承载。

- `presets/liangshen/minimal-prompt.mjs` 把每次组装出的提示词收窄到 persona 一段，匹配 `deployment:persona-prefix` 以及旧拼写 `deployment:persona` / `persona`。persona 的 prefix 承载一行 persona、本模式的固定工作纪律（思维循环即断、先理解需求与方案再实现、YAGNI/PDCA、代码不加注释），插件并在组装时追加会话工作区目录这一行方位信息（`Your working directory is <cwd>.`，从会话头读取）。plan mode 的 `plan:policy` 默认保留，因为该 section 是 plan mode 唯一的执行依据：退出工具在任何模式下都保持注册，也没有任何工具限制支撑它。若某次组装中没有任何 section 命中这些名字，插件降级为不裁剪的提示词并只告警一次，因此空系统提示词这类故障不会再静默发生。工作区指令由[其独立决策](2026-09-12-liangshen-agents-md-in-system-prompt.zh.md)承接。
- `presets/liangshen/tool-catalog.mjs` 观察 `system-prompt/assemble` 瀑布的返回值，并把逐工具的「参数签名 + 一行摘要」作为持久 user 消息追加在用户消息之后，形状与 `dsh-tool-skill` 注入 skill 目录一致。发布从第一步开始，索引的是完整的注册表 PTC 面——条目取自注册表，而不取自当前请求带的是哪张 wire——因此渲染文本跨呈现边界保持稳定。渲染是「条目列表 + 呈现计划」的一个稳定纯函数，已发布副本又从持久日志读回，因此只有当渲染文本与该会话可见面上最后一条目录消息不同（工具集变化，或副本被压缩遮蔽）时才会重发。状态不驻留内存，resume 与 reload 因此重建出同一决定。
- 注入消息的来源恰好是 `{ kind: 'plugin', plugin }`，与指令提示同形。`plugin` 是 v2→v3 迁移白名单与 v3 `MessageSourceMap` 都认的唯一注入 kind（[预设资产跟随当前 persona schema 与持久化消息来源](../../bug-fix/2026-09-10-preset-schema-and-message-source.zh.md)，issue #1455），而持久校验器对 `plugin` 允许的字段集是 `kind`、`plugin`、`form`、`sections`、`summary`——多带一个字段（例如存一份 `digest`）会被判为 unexpected member 而拒绝。
- 运行时上下文、工作区指令与 skill 目录按 Standard 模式正常流动。`presets/liangshen/tool-bootstrap.mjs` 与其锚定门控、晋升、PTC 呈现、消息来源白名单、延迟注入、bootstrap 预算封顶、压缩重置一并删除（[PTC 转换指引](../../bug-fix/2026-08-25-workshop-and-runtime-fixes.zh.md)随之失去对象）。轨迹分类器移入 `tools/analyze-session.mjs`，在那里它只是测量，不再是门控。

## Testing

- `tests/minimal-prompt.test.ts` 覆盖 section 过滤、工作区目录行（追加、旧 persona 名、不重复、无 cwd）、plan-policy 开关、无 persona 时的降级、`instructionSource: 'hint'` 下包含压缩后重置的 agent-instructions 提示，以及 workspace-instructions 提示词段及其发现、预算与降级路径。
- `tests/tool-catalog.test.ts` 覆盖注册表面的读取与其回退、参数签名渲染器、注入位置与消息形状、首发与更新、对持久日志的去重、压缩遮蔽后的重发、旧 `events` 会话形态、空面的各种情形、锚定回合分层（边界读取、只带 shell 的 wire 收窄、跨边界文本稳定）、PTC 声明及其各条降级路径，以及渲染器对畸形输入的降级。
- `tests/preset-composition.test.ts` 用仓库自有的 preset schema 校验随包发布的 `agent.cordis.yml`，并把 `PERSONA_SECTION_NAMES` 钉在已安装 SDK 的 `PERSONA_PREFIX_SECTION` 上——这是上述缺陷的回归防线。
- 在会话之外用已安装 harness 跑过随包 preset 目录：`scanRoot` 报告 preset 健康、无 broken 行；`fileComposition` 用 loader 自己的方言解析组合并求值了每个 `!!js` 门；persona 行配置被已安装的 `@deepseek-ai/dsh-persona` schema 接受为 `{ prefix, suffix: '', complete: false, includeRuntimeContext: true }`。
- 注入来源的形状过了已安装的持久 payload 校验器（`assertReleasedPayloadSemantics(event, 3)`，即 V3 `system/message` 路径对 plugin 来源消息本就会做的调用）：`{ kind: 'plugin', plugin }` 通过，而更早那版携带 `digest` / `count` 的候选被拒，报 `source has unexpected member "digest"`。这次校验正是随包插件不存 digest 的原因。

## Alternatives considered

- 保留两阶段跃迁，只修正 persona section 名。否决：空提示词只是可见症状，跃迁本身才是代价——被削弱的首轮、第二次目录变化带来的前缀缓存失效，以及五个相互纠缠的开关，其失败模式（goal 轮次在 phase 1 死锁、压缩后呈现复位）各自都需要单独修复。只改一个名字等于把这一切原样留下。
- 首轮继续只给两个工具，改为注入目录而不切换 wire。对完整清单而言否决：列出 wire 上并不存在的工具，是模型无法据以行动的能力声明；而锚定也会转而依赖这段注入文本被忽略。它的窄版本正是[分层笔记](2026-09-11-liangshen-anchor-turn-staging.zh.md)交付的形态：锚定回合自己的 schema 就是整个 wire，不带目录。
- 用 persona 行的 `complete: true` 取代 section 过滤。否决：registry 会在 assemble 瀑布之后恢复 complete section，因此 plan mode 的 `plan:policy` 永远到不了模型，该模式会保留工具却失去唯一约束它的文本。
- 把目录作为 prompt section 或运行时上下文投递，而不是 pre-step 消息。否决：两者都落在本模式刻意保持极简的前缀里，而需求明确是提示词尾部的 skill-catalog 形状。
- 每步都重发目录。否决：该消息是持久的，逐步追加会在日志与模型历史里各留一份副本。
- 把目录 digest 记在消息来源上，让重发判定只读一个字段。否决：持久校验器对 `plugin` 允许的字段集不接受它（见 Testing），而比较插件本就要写出的渲染文本根本不需要额外字段。
- 保留分类器作为一次更小跃迁的门控（例如锚定成立前先只隐藏文件系统工具）。否决：任何门控都会重新引入状态机，而本模式的前提正是锚定由系统提示词而非目录承载。

## Consequences

- 锚定回合刻意收窄：会话的第一次请求 wire 上只有 `anchorTools` schema，而 wire 的 schema 集只在回合边界变化一次——从 shell 换到收敛后的 PTC 面——因此回合内与第二次请求之后都不再发生由目录引起的缓存前缀变化；目录文本本身在边界处不变。
- 系统提示词在整个会话中字节稳定——那一行 persona，plan mode 开启时另加其策略段——工具调用后不再追加任何内容。
- 目录消息每个会话只有一条持久 user 消息，另有在工具集变化或压缩遮蔽时的一次替换，因此日志与历史里的增量有界且对缓存友好，而不是每步重复。
- plan mode 通过其策略段继续可用；`keepPlanPolicy: false` 可换取严格的一行表面，但会让该模式失去策略文本。
- 锚定轨迹从此是要测量的假设，而不再是强制的机制：`tools/analyze-session.mjs` 仍逐步报告 `we` / `let me` 标记，而本模式不再自行纠正漂移。
- preset 的工具清单保持两阶段版本的形态，因此持久 shell 仍会替代 Standard 的一次性 shell 直到会话结束，编辑器也仍继承宿主文件沙箱；不再发布 `workflow` 工具，与官方 PTC preset 一致，而它的引擎仍为 `ralph` 保留挂载。
