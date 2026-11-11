# Agent Note: LiangShen shell 与分页让 PTC 成为真正被执行的呈现

Status: implemented

部分取代[梁神模式针对 DeepSeek V4.1 Flash 的原生重构](2026-09-16-liangshen-v41-flash-native-rebuild.md)中关于 win32 shell 与温和分页作用范围的判断：preset 自带的 Git Bash `bash` 工具退役，改用上游持久 shell 栈的 pwsh 孪生；分页不再编辑组装出的 wire，改用作用域级工具限制，因为那是 `ptc` 下唯一能触达被执行面的编辑。会话单一呈现的决定、`ptc` 默认值、注入目录、消息来源与 persona 纪律全部继续有效。

## Problem

有两个已发布的机制并没有做到其文档所声称的事。

preset 为整个会话声明同一种呈现，并且出厂默认是 `presentation: 'ptc'`，也就是 wire 只携带 `run_code`。温和分页却是通过编辑 `system-prompt/assemble` 返回值里的 `tools` 数组实现的。这个编辑在 `ptc` 下完全不可见：`run_code` 程序经作用域的可见注册表触达工具，`tools:sdk` 提示词段也由同一份可见集合渲染，因此被扣留的命名空间在程序内照样可调用，它的 schema 也照样留在每一个请求里。能力没有省下，静态上下文也没有省下——变的只是目录里的一行。`maxResidentTokens` 度量的是组装出的 wire，因此永远不会在真正携带 schema 的那个面上触发；目录里的未激活命名空间摘要又在 `ptc` 下被抑制，模型连这些命名空间存在都不知道。

即便注册表级分页已经生效，出厂模式只填 `mcp__*` 仍会让预设挂载的全部插件工具族在每一轮常驻：实测一个梁神系会话组装出的系统提示词达 104,945 字符，其中 PTC 的 `interface ToolArgsMap` 段占 73,675 字符（约 70%，最重的 `task_board_*` 约 5.6k tokens、`browser_*` 约 3k、`squads_*` 与 `squad_*` 合计约 2.2k）。

另一处是 preset 的 win32 shell：由于持久 PTY 组在 win32 上被禁用，preset 自带 `custom-bash.mjs`，经普通子进程通道为每条命令新起一个 Git Bash 子进程。shell 状态不跨调用保留，该路径没有 OS 沙箱隔离，persona 还要带一行 win32 专属纪律，提醒模型把工作串进单次命令。这个移植的前提——PTY 后端只支持 Linux/Darwin——是错的：上游 `pwsh` 持久工具就是 win32 的对应物，内置 Minimal preset 早已把它挂在 `shellDialect: pwsh` 的 terminal-bash 行后面。

## Decision

preset 在两个平台都挂上游 shell 栈，并用作用域级限制 API 施加分页。

- shell 段与内置 Minimal preset 对齐：`persistent-shell` 组在每个平台都挂载，bash 半边（`terminal-bash`、`persistent-bash`）在 win32 禁用，它的 pwsh 孪生（`shellDialect: pwsh` 的 `terminal-bash` 加 `tool-pwsh-persistent`）在其余平台禁用，因此每个宿主恰好挂一个 shell 工具——POSIX 是 `bash`，win32 是 `pwsh`——且两个平台的状态都跨调用保留。`custom-bash.mjs`、它的测试、它的 preset 行以及 win32 persona 纪律行全部移除；preset 不再自带任何 shell 实现。
- 温和分页改用作用域级工具限制（`agent.ctx.tools.restrict({ deny })`）而非编辑组装结果，被扣留的命名空间因此离开作用域的可见集合：它的工具不再能从 `run_code` 程序内触达，它的声明也离开 `tools:sdk` 段——这正是让目录的承诺在任何呈现下都成立的做法。命名空间激活时精确解除限制，LRU 驱逐把它逐回时重新施加；限制失败会如实上报，并让会话保留原生面而不是一个坏掉的面。页面在组装瀑布**之外**安装——在作用域建立、会话开始与每次工具调用之后——因为 `SystemPrompt.assemble()` 会在瀑布运行前就渲染全部提示词段并收集工具 providers，在瀑布内安装的限制会晚一个请求生效，留下一个「目录说该命名空间被扣留、它自己的 `tools:sdk` 段却仍列出它」的请求。
- 由于分页现在真的把 schema 移出请求，`maxResidentTokens` 度量的是一个会收缩的面，目录在 `ptc` 下也像 `native` 与 `both` 一样携带被扣留命名空间的摘要。
- 分页只在 `ptc` 下作用于整个可达面。折叠后的 wire 让作用域注册表成为工具唯一可被触达的面，因此限制在那里就是分页本身的含义。`both` 刻意不安装限制：它的 wire 在 `run_code` 之外同时携带完整原生清单，被扣留的命名空间因此只在直调面缺席，程序内仍可触达——这份可达性由 wire 自己携带，因为 wire 持有全部已注册工具，且没有任何东西把被扣留的那些从作用域注册表里移除。`native` 根本不带程序，wire 分区就是那里分页的全部。
- 目录里的被扣留命名空间摘要逐呈现写明各自的可达性——`ptc` 下程序内同样不可达、`both` 下程序内仍可达、`native` 下不存在程序传输——而不再用同一句话描述两种代码呈现，让读者自己去和后面的程序契约对账。
- 激活状态依旧从持久会话事件流重建，因此压缩与恢复无需进程内存即可还原同一张激活集合与同一张限制集合。
- `presets/liangshen/paging.mjs` 中的 `DEFAULT_PAGED_TOOL_PATTERNS`（以及 `presets/liangshen/agent.cordis.yml` 中 `tool-catalog`、`tool-activate` 与 `working-context` 三行的 `pagedToolPatterns`）出厂携带 7 项前缀模式：`['mcp__*', 'browser_*', 'task_board_*', 'team_*', 'squad*', 'ui_*', 'ssh_*']`；预设挂载的全部宿主内建工具（`bash` / `pwsh`、文件系统/read/write/edit/`str_replace_editor`、`glob` / `grep`、后台作业、`skill`、`ask_user_question`、`todo_write`、`web_search`、子代理委派、plan、goal、`fact_register`、`tool_activate`、`run_code` 与 MCP 资源读取工具）均不命中任何出厂模式，全程保持常驻。每条模式必须是「不含 `*` 的非空字面头部 + 单个结尾 `*`」（裸 `*` 会被拒绝，因为无头通配符推导不出工具族名且不会对任何工具分页），`patternNamespace` 按该头部推导命名空间：以 `__` 结尾的头部视为 MCP 桥接，取余下工具名的第一个 `__` 分段（`mcp__codegraph__codegraph_explore` -> `codegraph`）；其余头部直接命名插件工具族并去掉至多一个结尾 `_`（`task_board_*` -> `task_board`，`squad*` -> `squad`，将 `squads_*` 与 `squad_member_*` 归入同一个 `squad` 命名空间）。同时最多保持 `DEFAULT_MAX_ACTIVE_NAMESPACES`（`3`）个活跃分页命名空间，激活或对已激活命名空间内工具的非报错调用都会刷新新近度，激活第四个时将最近最少使用的逐回摘要状态。运维者可通过插件设置项 `pagedToolPatterns`（默认 `''`，在 `src/client/LiangShenSettingsCard.tsx` 设置卡片中显示为「按需工具族」 / "On-demand tool families"）改写清单：`src/composition.ts` 中的 `parsePagedToolPatterns` 把逗号分隔条目解析成数组同时写入 `tool-catalog`、`tool-activate` 与 `working-context` 三行（三行都按各自的 `pagedToolPatterns` 重放会话日志，保持同源可避免目录驱逐与 `tool_activate` 判定分叉而锁死被扣留的命名空间），空白文本或含任一非法条目时不写覆盖项而继承出厂 7 项清单（设置卡片同样对非法草稿保持不写入，清空则恢复继承）。
- 关键事实登记簿遵循同一规则。`foldFactLedger` 同时读取会话能记录一次调用的两种形态——`native` 记录为顶层 `tool/call`，`ptc` 把程序内的调用记录为 `tool/ptc-dispatch`——并跳过报错的 dispatch。只读 `tool/call` 会让登记簿在每个出厂默认会话里都是空的：`fact_register` 返回登记成功，而保证命中的那一行从未携带过 `key facts` 字段。`native` 半边保持既有语义，包括本次刻意不动的那一条：报错的顶层调用仍会被折叠，因为这份折叠没有 `tool/result` 过滤。
- wire 由预设自己按作用域的声明决定（2026-10-26）。`agent.ctx.tools.presentAs(mode)` 就是 0.2.1 的 API——内置预设的 `@deepseek-ai/dsh-agent-tool-presentation` 行调用的正是它，作用于所挂载的 scope——因此 `tool-catalog` 行上的 `presentation` 取值**就是** wire：插件在 agent scope 一出现时就声明它，声明落在组装中途时重新组装一次；部署没挂 PTC runtime、宿主拒绝声明、或读不到任何 schema 投影时退回原生面并告警一次。组合里不再有执行器行：曾有一版挂了 `@deepseek-ai/dsh-tool-executor-ptc`，但 SDK 在 0.2.1-rc.3 并不发布该包（npm 上也从未有过），那一行永远不会启动，预设的激活审计会把它和真正挂上的行并列报出。`applyPresetOverrides` 只写 `tool-catalog` 一个取值，基准变体改写同一行，因此设置开关、出厂组合与两个基准臂仍然只决定一条 wire。

## Alternatives considered

保留组装过滤，并写明它在 `ptc` 下只是一个目录层面的装饰。否决：那会保留一个与被执行面矛盾的能力声明（`mcp__*` 工具被扣留在 wire 之外），而且建立在其上的守卫永远不会触发。

让所有被扣留的命名空间常驻 SDK 声明，只移除直接调用面。否决：它保住了程序内可达性，却让这些 schema 留在每一个请求里，而那正是分页要消除的成本；两个目标直接冲突，本模式选择了「可达子集」这一契约。

用 preset 自有的过滤器同时过滤组装结果与 SDK 段来恢复分页。否决：那是重复实现宿主已有的机制，而宿主自己的作用域限制是按 agent、可撤销，并且已经排除了 `run_code` 传输工具。

保留 `custom-bash.mjs`，只把它的限制写进文档。否决：它的前提已被证伪、它与真正的 `bash` 共享名字却语义不同（无状态、无 OS 沙箱隔离），persona 还需要一行平台专属纪律来补偿——同一个错误形状的三个症状。

在 win32 挂内置 PTC 预设的一次性 `pwsh`，而不是持久孪生。否决：内置 Minimal 的持久栈在 win32 上可用且能力严格更强；一次性行会保留本次决定要消除的状态丢失问题。

## Consequences

本模式在 win32 的会话从此以 PowerShell 作为 shell，这是面向模型的变化：为 bash 写的命令要改写成 PowerShell，此前的 Git Bash 兜底（`bashPath`、Git Bash 探测）不再存在。shell 状态如今在每个平台都跨调用保留，因此那条 win32「把操作串进单次调用」的纪律行随其动机一起消失。

分页在每次激活与驱逐各付一次限制切换的开销，且在 `ptc` 下被扣留的命名空间在激活前在程序内确实不可用——模型此前无需激活就能触达的工具，现在可能要先激活，这是既定契约而非回归。六个挂载的插件工具族（`browser`、`task_board`、`team`、`squad`、`ui`、`ssh`）与 `mcp__*` 一并默认按需分页后，不用到它们的会话不再携带其 `interface ToolArgsMap` schema，而宿主内建工具全部常驻；用到它们的会话付出一次 `tool_activate` 调用并与 MCP 服务共享 3 个命名空间的 LRU 上限，需要调整常驻/分页边界的运维者可在插件设置卡片中改写 `pagedToolPatterns`。在 `both` 下页面只落在直调面上，同一个工具在激活前依然能从程序内触达，被扣留的只有直调。

preset 不再携带任何平台专属的 persona 文本，因此在给定 cwd 下，系统提示词在两个平台上逐字节一致。

## Testing

`tests/platform-guard.test.ts` 对注入平台的 `!!js` 门求值而不是匹配文本，断言组本身不带门、两半的极性恰好成对、每个平台恰好挂一个 shell 工具。`tests/minimal-prompt.test.ts` 断言 persona 在 win32 与 POSIX 上完全一致，且源码中不再有平台分支。分页行为由 preset 的目录、激活、组合、设置卡片与分页套件覆盖：`tests/tool-activate.test.ts` 钉住出厂 7 项 `DEFAULT_PAGED_TOOL_PATTERNS`、`patternNamespace` 的两个分支（`__` 结尾 MCP 桥接与字面插件工具族，含 `squad*` 合并 `squads_*` 与 `squad_member_*`）、裸 `*` 拒绝、宿主内建工具常驻，以及插件工具族的 LRU 新近度；`tests/tool-catalog.test.ts` 钉住每种呈现的被扣留可达性句子、同一工具面重复渲染的逐字节一致文本、可判定的程序触发条件、`ptc` 请求在 wire 缺少 `run_code` 时的一次性告警，以及插件工具族的 `<inactive_namespaces>` 摘要与激活标题；`tests/tool-paging-registry.test.ts` 钉住插件工具族在各呈现下的扣留、激活、第四族 LRU 驱逐与宿主内建工具常驻（并断言旧 `both` 不安装任何限制）；`tests/preset-composition.test.ts` 钉住 `tool-catalog`、`tool-activate` 与 `working-context` 三行提交的 7 项 `pagedToolPatterns` 清单；`src/composition.test.ts` 钉住执行器行挂载状态、`parsePagedToolPatterns` 三行同步覆盖以及空白/非法文本继承出厂清单；`tests/settings-card.spec.tsx` 钉住 `pagedToolPatterns` 字段的草稿暂存、非法草稿保留不写与清空恢复继承。`tests/fact-ledger.test.ts` 钉住登记簿对两种 wire 形态的折叠：事实与其 tag、按 tag 与按原文的撤销、不得生效的报错 dispatch、跨两种形态的同一顺序与同一上限，以及必须被忽略的无关工具与 `tool/ptc-dispatch-start` 事件；`tests/working-context.test.ts` 在投影层断言经 `ptc` wire 登记的事实确实进入 `[Working Context: ...]` 行与注入消息。
