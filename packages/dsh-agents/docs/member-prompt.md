# 成员简报注入判定（member-prompt spike）

本文件归属 `packages/dsh-agents`：记录「成员 brief 如何进入该成员会话的系统提示词」这一判定的证据与结论，以及不可行时的兜底设计。实现见 `src/host/member-prompt.ts`。

## 结论

**可行（workable）**：本插件在宿主根上下文注册一个 untagged 的 `systemPrompt.section`，其 `text` 是函数，每次 assemble 时由装配上下文取到 session id，再查本插件账本得到该成员的 brief；普通用户会话返回空串，空段会被渲染丢弃。
不需要为每个成员物化预设包，也不需要把 brief 写进首条用户消息。
唯一已知例外：成员预设挂了 `complete` 段（如 `@deepseek-ai/dsh-persona` 的 `complete: true`）时，官方规则把该段还原为唯一段，本节被丢弃；兜底见文末。

## 装配上下文实际暴露的身份

- `AssembleContext` 本体只有两个字段：`scope`（`ScopeKey`，不透明对象）与 `signal`，见 `@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts` 中 `declare module '@deepseek-ai/dsh-system-prompt'` 的合并声明，以及 `@deepseek-ai/dsh-system-prompt/lib/types/index.d.ts:37-45`。
- `@deepseek-ai/dsh-agent` 把 `agent` 合并进该接口，注释写明「Agent for this assembly; absent on diagnostics. When present, `scope` must identify the same agent.」（`runtime-types.d.ts:15-19`）。
- 构造处唯一实现：`assembleContextFor(agent, signal)` 返回 `{ agent, scope: agent, ...(signal ? { signal } : {}) }`（运行中的宿主 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar` 内 `dsh/node_modules/@deepseek-ai/dsh-agent/lib/index.js:292-296`；npm SDK 副本同源）。
- `Agent` 的身份就是 session id：`export interface Agent { readonly id: SessionId }`（`@deepseek-ai/dsh-agent/lib/types/types.d.ts:11-14`）。
- 因此可用的匹配身份只有 **session id**。装配上下文不暴露预设 id、不暴露 workspace、不暴露 team/member id：任何「按预设区分」的逻辑只能来自该预设自己那一行的 scope，不可能在全局段里读到。

## 段如何被接纳

- `SystemPrompt.assemble()` 把全局层与 scope 链合并后再渲染段：`const sectionByName = this.layers.merge(scope, (layer) => layer.sections)`（asar `.../dsh-system-prompt/lib/index.js:364`），`merge` 先取 global 层条目再按 scope 链覆盖（`@deepseek-ai/dsh-scope/lib/index.js:177-178`）。
- 段落注册走 `ScopedLayers.effect`：`const scope = scopeOf(ctx)`，`if (scope === void 0) layer = this.global`（`@deepseek-ai/dsh-scope/lib/index.js:189-195`）。插件行挂在部署根上下文时 ctx 不带 scope，注册进全局层，因而参与**每一次**装配，包括由任意预设组合出来的成员会话。
- `text` 为函数时每次装配调用一次，参数就是该次装配的上下文：`text: typeof section.text === "function" ? section.text(context) : section.text`（asar `.../dsh-system-prompt/lib/index.js:389`）。
- 空段在渲染时被丢弃（`renderPrompt` 契约：`@deepseek-ai/dsh-system-prompt/lib/types/index.d.ts:200-209`），因此对非成员会话本插件不改变系统提示词一个字节。

## 官方预设侧席位为什么不是本判定的必选项

`@deepseek-ai/dsh-persona` 是预设内写死角色文本的官方席位：它在挂载上下文的 scope 内注册 `deployment:persona-prefix` / `deployment:persona-suffix` 两段，文本取 `config.prefix` / `config.suffix`（asar `.../dsh-persona/lib/index.js:36-47`），并自述「this row is **scope-only**. Mounted inside an agent preset it shadows the deployment persona for that one session ... mounted globally it collides with the registry's own registration and fails loud」（同文件 8-15 行）。它的文本是静态配置，装配时才计算的能力不属于它。

成员 brief 是按会话变化的动态文本，静态 `config.prefix` 装不下「同一个预设、不同成员、各自一段简报」的情形；全局动态段才是本判定的自然席位。persona 行因此只在兜底方案里作为载体出现。

## 本插件的实现

- 纯匹配：`memberBriefFor(context, view)` 从 `context.agent.id`（缺失时读 `agent.sessionId`）取得 session id，取该会话最新一条 `RunRecord`，再按 `teamId`/`memberId` 查定义，返回 `brief`；定义被删、会话不是成员运行、brief 为空，一律返回空串。
- 唯一的宿主调用：`registerMemberPromptSeam(ctx.systemPrompt, () => service.promptView())`，段名 `dsh-agents:member-brief`，位置为部署 persona 前缀之后一位；读取账本发生在**装配时刻**，所以两轮之间改过的 brief 下一轮即生效。
- 账本损坏时 `promptView()` 返回空视图，绝不因为账本问题让用户普通的会话回合失败。

## 已知例外与兜底设计

- 例外一：预设把 persona 段设为 `complete: true`（`@deepseek-ai/dsh-persona/lib/index.js:25-30`）。官方装配在 waterfall 之后把该段还原为**唯一**段（`PromptSection.complete` 契约，`@deepseek-ai/dsh-system-prompt/lib/types/index.d.ts:63-69`），本插件的段被丢弃。这类预设主动声明「系统提示词由我独占」，注入方无法绕过。
- 例外二：任何其它注册 `complete` 段的预设，效果同上。
- 兜底（若上述预设成为常态）：在**定义保存时**为每个成员物化一个轻量预设包，写 `$DSH_HOME/agent-presets/<member-preset-id>/`，只挂一行 `@deepseek-ai/dsh-persona`，`config.prefix` 为成员 brief，运行该成员时用该预设 id 组合会话；成员若自己也钉了预设，则把被钉预设的插件行复制进这份物化预设并在其后追加 persona 行，使 persona 段仍按 scope 覆盖。代价是定义保存变成一次写操作、预设注册表要跟着刷新、且删除成员必须清理落盘资产；`registerMemberPromptSeam` 是唯一调用点，切换只改这一个函数，账本、路由与运行顺序都不动。
- 整队运行不走这条判定：teammate 是由队长用原生 subagent 起的普通子会话，本段只对成员运行会话生效；teammate 的简报由队长写进 spawn 提示词首段，名册 `team:squad` 为每个成员给出完整简报正是为此。
- 整队的 Lead 会话不靠简报段：它要的是「本小队有哪些成员、本次目标是什么」，这部分以 `team:squad` **context**（`ctx.systemPrompt.context`）注册，因此不受本节例外一/二影响——`complete` 段还原的是 section，context 照常渲染。实现见 `src/host/squad.ts` 与 `src/index.ts` 的 `registerSquadPromptContext`。

## 验证

- `tests/member-prompt.spec.ts`：身份提取（含字段改名兜底与拒绝猜测）、按会话取最新运行、定义删除后不再注入、非成员会话为空、注册顺序与「每次装配读一次账本」。
- 运行：`pnpm --filter ./packages/dsh-agents test`。
