# Agent Note: 梁神模式改以 user 角色送达工作区指令

Status: implemented

部分取代[梁神模式把 AGENTS.md 指令提升进系统提示词](2026-09-12-liangshen-agents-md-in-system-prompt.zh.md)的送达通道部分：提示词内送达不再是本模式的默认行为。

## Problem

把工作区指令链作为 `workspace-instructions` 系统提示词段送达、同时丢弃宿主自己的注入，带来三项此前未被计入的代价。

系统提示词每次组装都重新渲染，因此任一指令文件被编辑都会改动缓存前缀内部的文本，使其后所有已缓存的请求位置失效。宿主保持注入仅追加——基线变化时追加一条完整替换，而不是改写既有历史——正是为了让已缓存的指令前缀在文件被编辑后依然存活。

被丢弃的注入不会成为带 source 的 `user/message` 事件。指令文本改落在 `system/message` surface 节点上：它不参与宿主对指令文件的 source/digest 对账，会话引用投影也会跳过这类节点，因此该文本不会进入以引用形式投影出的会话。

把文本从 user 角色消息搬进系统提示词，还去掉了宿主用消息角色承载的结构性声明：工作区指令文件是指导性内容，不覆盖 system、developer 或用户的直接指令。用户全局 `AGENTS.md` 因此与 persona 的常设纪律处在同一层级。

## Decision

`instructionSource` 新增并默认取 `host`：插件不追加任何提示词段，原样返回进入的消息批，宿主的 `agent-instructions` 注入因此与其它 preset 完全一致地到达模型——一条承载用户全局与项目链的持久 user 角色基线，随后是触碰目录带来的增量、替换与移除。

`system-prompt` 保留提示词内送达，作为需要把指令文本放进系统提示词的部署的可选项；它在 `instructionMaxBytes` 预算下追加 `workspace-instructions` 段，并按原逻辑过滤宿主消息。`hint` 不变。

## Alternatives considered

- 保留 `system-prompt` 作为默认，只加强注入链内的措辞。否决：削弱约定遵循度的是本模式新增的 hint 通道措辞，而不是新默认所使用的宿主基线，因此仅改变送达通道即可回应诉求；改写宿主自己的基线文案则会让 preset 去编辑运行期归属的消息文本。
- 默认改为 `hint`。否决：hint 把首条注入替换成一条指针，其措辞告诉模型这些参考文件无关紧要，而那正是所有者否决的行为；`host` 从第一次请求起就送达同样的内容，且没有那种措辞。
- 保留提示词段，同时放行宿主消息。否决：模型会在每个请求里收到两遍指令链，且两遍措辞不一致。
- 在插件内为所有模式复刻宿主的触碰路径 reconcile。否决：`host` 模式下宿主已经在 reconcile 后代文件；插件自己的发现只服务于 `system-prompt` 模式，因为该模式丢掉了它本会重复的宿主消息。

## Consequences

- 梁神模式会话的系统提示词是 persona 块、plan mode 的 `policy`，以及 wire 携带 `run_code` 时的官方 PTC 段；指令链不再占用其中位置。
- 编辑指令文件不再让缓存前缀位置失效：基线是一条仅追加的持久消息，此后每次刷新都追加在其后。
- 指令文本重新出现在会话日志中，且基线携带宿主自己的优先级与权威声明。
- 后代指令文件在默认模式下经由宿主的 reconcile 到达模型；插件的触碰目录发现只服务于可选的 `system-prompt` 模式。
- 可选的 `system-prompt` 模式保留其代价：每次组装重渲染前缀、指令文本落在 `system/message` 节点上而非带 source 的指令事件上、该文本与 persona 同层。

## Testing

- `tests/minimal-prompt.test.ts` 覆盖默认 `host` 模式（不追加段落；`agent-instructions` 消息逐字原样通过），同时保留 `system-prompt` 与 `hint` 两套测试。
- `tests/preset-composition.test.ts` 钉住出厂的 `instructionSource: host` 行及其 `instructionMaxBytes: 65536` 预算。
