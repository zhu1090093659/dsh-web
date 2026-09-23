# Agent Note: LiangShen shell 与分页让 PTC 成为真正被执行的呈现

Status: implemented

部分取代[梁神模式针对 DeepSeek V4.1 Flash 的原生重构](2026-09-16-liangshen-v41-flash-native-rebuild.md)中关于 win32 shell 与温和分页作用范围的判断：preset 自带的 Git Bash `bash` 工具退役，改用上游持久 shell 栈的 pwsh 孪生；分页不再编辑组装出的 wire，改用作用域级工具限制，因为那是 `ptc` 下唯一能触达被执行面的编辑。会话单一呈现的决定、`ptc` 默认值、注入目录、消息来源与 persona 纪律全部继续有效。

## Problem

有两个已发布的机制并没有做到其文档所声称的事。

preset 为整个会话声明同一种呈现，并且出厂默认是 `presentation: 'ptc'`，也就是 wire 只携带 `run_code`。温和分页却是通过编辑 `system-prompt/assemble` 返回值里的 `tools` 数组实现的。这个编辑在 `ptc` 下完全不可见：`run_code` 程序经作用域的可见注册表触达工具，`tools:sdk` 提示词段也由同一份可见集合渲染，因此被扣留的命名空间在程序内照样可调用，它的 schema 也照样留在每一个请求里。能力没有省下，静态上下文也没有省下——变的只是目录里的一行。`maxResidentTokens` 度量的是组装出的 wire，因此永远不会在真正携带 schema 的那个面上触发；目录里的未激活命名空间摘要又在 `ptc` 下被抑制，模型连这些命名空间存在都不知道。

另一处是 preset 的 win32 shell：由于持久 PTY 组在 win32 上被禁用，preset 自带 `custom-bash.mjs`，经普通子进程通道为每条命令新起一个 Git Bash 子进程。shell 状态不跨调用保留，该路径没有 OS 沙箱隔离，persona 还要带一行 win32 专属纪律，提醒模型把工作串进单次命令。这个移植的前提——PTY 后端只支持 Linux/Darwin——是错的：上游 `pwsh` 持久工具就是 win32 的对应物，内置 Minimal preset 早已把它挂在 `shellDialect: pwsh` 的 terminal-bash 行后面。

## Decision

preset 在两个平台都挂上游 shell 栈，并用作用域级限制 API 施加分页。

- shell 段与内置 Minimal preset 对齐：`persistent-shell` 组在每个平台都挂载，bash 半边（`terminal-bash`、`persistent-bash`）在 win32 禁用，它的 pwsh 孪生（`shellDialect: pwsh` 的 `terminal-bash` 加 `tool-pwsh-persistent`）在其余平台禁用，因此每个宿主恰好挂一个 shell 工具——POSIX 是 `bash`，win32 是 `pwsh`——且两个平台的状态都跨调用保留。`custom-bash.mjs`、它的测试、它的 preset 行以及 win32 persona 纪律行全部移除；preset 不再自带任何 shell 实现。
- 温和分页改用作用域级工具限制（`agent.ctx.tools.restrict({ deny })`）而非编辑组装结果，被扣留的命名空间因此离开作用域的可见集合：它的工具不再能从 `run_code` 程序内触达，它的声明也离开 `tools:sdk` 段——这正是让目录的承诺在任何呈现下都成立的做法。命名空间激活时精确解除限制，LRU 驱逐把它逐回时重新施加；限制失败会如实上报，并让会话保留原生面而不是一个坏掉的面。页面在组装瀑布**之外**安装——在作用域建立、会话开始与每次工具调用之后——因为 `SystemPrompt.assemble()` 会在瀑布运行前就渲染全部提示词段并收集工具 providers，在瀑布内安装的限制会晚一个请求生效，留下一个「目录说该命名空间被扣留、它自己的 `tools:sdk` 段却仍列出它」的请求。
- 由于分页现在真的把 schema 移出请求，`maxResidentTokens` 度量的是一个会收缩的面，目录在 `ptc` 下也像 `native` 与 `both` 一样携带被扣留命名空间的摘要。
- 激活状态依旧从持久会话事件流重建，因此压缩与恢复无需进程内存即可还原同一张激活集合与同一张限制集合。

## Alternatives considered

保留组装过滤，并写明它在 `ptc` 下只是一个目录层面的装饰。否决：那会保留一个与被执行面矛盾的能力声明（`mcp__*` 工具被扣留在 wire 之外），而且建立在其上的守卫永远不会触发。

让所有被扣留的命名空间常驻 SDK 声明，只移除直接调用面。否决：它保住了程序内可达性，却让这些 schema 留在每一个请求里，而那正是分页要消除的成本；两个目标直接冲突，本模式选择了「可达子集」这一契约。

用 preset 自有的过滤器同时过滤组装结果与 SDK 段来恢复分页。否决：那是重复实现宿主已有的机制，而宿主自己的作用域限制是按 agent、可撤销，并且已经排除了 `run_code` 传输工具。

保留 `custom-bash.mjs`，只把它的限制写进文档。否决：它的前提已被证伪、它与真正的 `bash` 共享名字却语义不同（无状态、无 OS 沙箱隔离），persona 还需要一行平台专属纪律来补偿——同一个错误形状的三个症状。

在 win32 挂内置 PTC 预设的一次性 `pwsh`，而不是持久孪生。否决：内置 Minimal 的持久栈在 win32 上可用且能力严格更强；一次性行会保留本次决定要消除的状态丢失问题。

## Consequences

本模式在 win32 的会话从此以 PowerShell 作为 shell，这是面向模型的变化：为 bash 写的命令要改写成 PowerShell，此前的 Git Bash 兜底（`bashPath`、Git Bash 探测）不再存在。shell 状态如今在每个平台都跨调用保留，因此那条 win32「把操作串进单次调用」的纪律行随其动机一起消失。

分页现在每次激活与驱逐各付一次限制切换的开销，而被扣留的命名空间在激活前在程序内确实不可用——模型此前无需激活就能触达的工具，现在可能要先激活，这是既定契约而非回归。

preset 不再携带任何平台专属的 persona 文本，因此在给定 cwd 下，系统提示词在两个平台上逐字节一致。

## Testing

`tests/platform-guard.test.ts` 对注入平台的 `!!js` 门求值而不是匹配文本，断言组本身不带门、两半的极性恰好成对、每个平台恰好挂一个 shell 工具。`tests/minimal-prompt.test.ts` 断言 persona 在 win32 与 POSIX 上完全一致，且源码中不再有平台分支。分页行为由 preset 的目录、激活与分页测试覆盖。
