# Agent Note: 梁神模式把 AGENTS.md 指令提升进系统提示词

Status: implemented

部分被[恢复四工具锚定与 PTC 语义修正](2026-09-12-liangshen-anchor-tools-and-ptc-refinement.zh.md)取代：工作区子目录动态指令后续将支持注册文件工具（含 `str_replace_editor`）及 PTC 内子调用触达的目录。

部分被[改以 user 角色送达工作区指令](2026-09-17-liangshen-workspace-instructions-user-role.zh.md)取代（送达通道部分）：系统提示词段不再是默认行为。

部分取代[极简 persona 加注入式标准工具目录](2026-09-11-liangshen-minimal-prompt-tool-catalog.zh.md)的指令部分：agent-instructions 提示不再是本模式的默认行为。该 note 的 persona、注入目录与消息来源决策全部继续有效。

## Problem

本模式此前只有一条通道承载工作区指令：一次性的上下文提示（`Reference documents exist: ... the task itself never depends on them`）加模型按需读文件。这个措辞是刻意的——上游 anchored-standard 评测（dsh-anchored-standard #49，E1/E1.5/E2）实测过 AGENTS.md 全文注入会翻转锚定轨迹——但实际效果是提示告诉模型这些指令无关紧要，会话在碰巧读到文件之前会持续偏离用户全局与仓库约定。所有者希望指令内容在本模式全程保持权威的地方拥有常设分量：系统提示词，而不是按会话的上下文注入。

## Decision

`presets/liangshen/minimal-prompt.mjs` 在提示词组装时自行读取工作区指令文件，把它们作为一段 `workspace-instructions` 追加进系统提示词；harness 的 agent-instructions 注入被整体丢弃。插件配置中 `instructionSource` 取代 `instructionHint`：`system-prompt` 选择本 note 的提示词内送达，`hint` 原样恢复先前的指针行为，而[出厂默认是 `host`](2026-09-17-liangshen-workspace-instructions-user-role.zh.md)，不改动宿主自己的注入。

- 发现逻辑镜像 harness 的基线链（`dsh-agent-instructions`）：先 `$DSH_HOME/AGENTS.md`（非默认 home 时显示为 `$DSH_HOME`，默认显示 `~/.dsh/AGENTS.md`），再从项目根——最近的持有 `.git` 标记的祖先目录，没有则以 cwd 为根——到会话 cwd 沿途的 `AGENTS.md` / `CLAUDE.md` 及 `.local` 覆盖层，由宽到窄，按目录以去空白内容去重，同样的 1 MiB 源文件上限。插件另外自行 reconcile 后代目录：`read`/`write`/`edit`/`str_replace_editor` 的一次执行会记录被触碰的目录，`agent/pre-step` 再把这些目录的指令文件作为插件消息追加（见 Consequences）。
- 预算在 `instructionMaxBytes`（默认 65536，与 preset 的 `agent-instructions` 行出厂值相同）下镜像 harness 的优先级：整条链放不下时先省略最宽的文件、最后才在 UTF-8 边界截断最具体的文件，并用标记行记录丢弃了什么。
- 该段以 `{ name: 'workspace-instructions', text: '{{workspace_instructions}}' }` 进组装结果，渲染文本由 `variables.workspace_instructions` 携带。harness 的 `renderPrompt` 对每个 section 做严格插值——未知的 `{{name}}` 引用会抛错，指令文件里只要出现一个 `{{...}}` 示例，每个请求都会失败——而变量的值是原样插入、不再二次扫描的。覆盖瀑布返回值是文档写明的扩展点（"the returned waterfall value is authoritative"）。
- 位置在最后：persona 块（persona、工作纪律、工作区目录行）、plan mode 的 `plan:policy`，然后是指令。动态段位于稳定前缀之后，锚定的缓存前缀不受影响。
- 读取在每次组装时发生、无按会话状态，文件改动在下一次请求生效，压缩与恢复无需重发。读取失败或会话没有 cwd 时不追加该段；意外错误只告警一次。
- pre-step 在该模式下对每条 `agent-instructions` 消息做 reconcile，而不是 hint 的首条替换：纯属所覆盖基线的消息保留一条短标记并保持其 source schema，动态与混合消息原样通过，未标记的基线消息则被丢弃——提示词已经携带其内容；读取基线失败或为空时全部原样通过。preset 保留 `dsh-agent-instructions` 行，`instructionSource: 'hint'` 继续可用、其 `maxBytes` 仍是那个模式的预算。

## Testing

- `tests/minimal-prompt.test.ts` 在临时的 `$DSH_HOME` 与项目目录上运行：追加段的名称、位于稳定前缀之后的位置与变量间接；`$DSH_HOME` 与项目根相对显示路径；由宽到窄的顺序；候选文件与覆盖层覆盖及按目录去重；基线链边界（后代 `docs/AGENTS.md` 不进入）；逐组装重读；预算省略与 UTF-8 安全截断；纯渲染器的退化预算守卫；缺失 cwd 与不可探测 cwd 的降级；以及 harness 自己的 `renderPrompt` 逐字渲染该段（含 `{{evil}}` 示例）。hint 测试在 `instructionSource: 'hint'` 下原样保留。
- `tests/preset-composition.test.ts` 钉住出厂的 `instructionSource: host` 与 `instructionMaxBytes: 65536` 行。

## Alternatives considered

- 保留 hint 作为默认。所有者否决：指针的非命令式措辞（「the task itself never depends on them」）实际削弱了工作区约定的遵循度，而本模式的存在理由就是让指令内容在每个请求上都具备常设权威。上游证据针对的是作为上下文注入的全文，不是常设提示词文本。
- 在 pre-step 捕获 harness 的注入消息，从下一次组装起把内容回填为提示词段。否决：请求循环先跑 `system-prompt/assemble` 再跑 `agent/pre-step` 瀑布（dsh-agent-loop），第一次请求会既没有内容也没有提示，且缓存的副本会相对文件改动过期。
- 在 `minimal-prompt.mjs` 里 import 宿主插件导出的 `loadBaselineInstructions`。否决：preset 本地插件文件是按绝对路径从声明方包内随包的 preset 目录加载的，因此其中的裸包名会解析到该包自己的依赖树，而不是 harness 的运行时模块——harness 只从自己的基座解析它要挂载的组合行，而不是 preset 文件内部的 import。因此 preset 本地插件只用 node 内建模块，随包的 preset 本地模块都是如此。
- 把渲染后的内容直接放进 section 文本。否决：`renderPrompt` 对 section 文本做严格插值，任何含 `{{...}}` 的指令文件（agent 指令里模板示例很常见）都会让每个请求抛错；变量间接携带同样的文本而不扫描它。
- 保留 harness 注入、同时追加提示词段。否决：模型会从两条通道各看到一遍同样的指令，措辞还不一致。
- 镜像 harness 的动态 touched-path reconcile（`read`/`write`/`edit` 触碰目录时浮出的嵌套指令文件）为额外提示词内容。已在 `system-prompt` 模式落地：插件从 `tools/result` 追踪执行、在下一次 `agent/pre-step` 追加被触碰目录的指令文件，而不依赖宿主的文件名校验——后者的触发名是 Standard 的 `read`/`write`/`edit`，本模式却经 `str_replace_editor` 编辑、第二个回合起更是 PTC 程序。想要动态指针行为的部署可以选 hint 模式。

## Consequences

- `system-prompt` 模式下会话第一次请求不再复刻官方 Minimal 的提示词形态：其系统提示词是 persona 块、plan mode 策略与指令链。锚定工具面（先 `bash`、后 PTC）不变，指令渲染在稳定前缀之后，跨请求的缓存前缀仍以 persona 开头。
- `system-prompt` 模式下指令内容跨压缩、跨恢复留存，无需持久消息、无按会话状态；hint 模式的压缩重置机制在该模式下闲置。
- `system-prompt` 模式下提示词体积增加一条指令链的量：在本仓库根打开的会话约 16 KB（用户全局加根 `AGENTS.md`），在 65536 字节预算之内。
- `system-prompt` 模式下后代指令文件同样能到达模型：宿主的动态消息原样通过 pre-step；对宿主文件名校验覆盖不到的执行——`str_replace_editor` 与 PTC 内子调用——插件从 `tools/result` 记录被触碰的目录，并在下一次 `agent/pre-step` 追加该目录的指令文件。
- 宿主插件的基线可见性检测读取持久事件里的 `source.baseline === true`，而压缩后的基线标记保留了该 source 字段——因此在这个模式下宿主不会每个 pre-step 都重新组装未变化的基线。
- `instructionHint` 不复存在；设置它的组合会得到具名的配置校验错误，而不是静默改变行为。
