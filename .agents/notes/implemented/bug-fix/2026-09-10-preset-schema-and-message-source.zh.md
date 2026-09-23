# Agent Note: 预设资产跟随当前 persona schema 与持久化消息来源

Status: implemented

## Problem

2026-09-10 针对 DSH 0.1.5-rc.1 提交的两个 Bug 报告属于同一类缺陷：本仓库为 agent-preset 平面提供的资产写在了当前 harness 已不再接受的契约上。

- Issue #1450：`liangshen` 预设无法挂载。`presets/liangshen/agent.cordis.yml` 仍用已退役的 `text` 键配置 persona 行，而 `@deepseek-ai/dsh-persona` 0.1.5-rc.1 声明的是 `prefix: z.string().required()`（另有 `suffix`、`complete`、`includeRuntimeContext`）。挂载报 `$.prefix missing required value`，所有使用该预设的会话都无法对话。
- Issue #1455：历史里带有梁神模式指令提示的会话无法恢复。`tool-bootstrap.mjs` 给注入的提示消息打的自定义来源 kind 是 `instruction-hint`。v2→v3 迁移白名单（`@deepseek-ai/dsh-session-format-v2-to-v3` 的 `SOURCE_KINDS`）与 `@deepseek-ai/dsh-api-session-controller` 的 v3 `MessageSourceMap` 都只认固定的一组 kind，其中没有它，迁移报 `cannot safely transform unclassified message source` 并保留原 v2 文件，会话打不开。

同一个已退役的 `text` 键还在社区预设模板（`packages/dsh-preset-center/presets/_template/agent.cordis.yml`）里；预设中心 README 明确让作者复制该模板，因此由它派生的每个预设都会踩到同样的挂载失败。

## Decision

- 梁神预设的 persona 行与预设模板都改用 `prefix`，不再使用已退役的 `text`。
- `buildInstructionHint` 用 `{ kind: 'plugin', plugin: name }` 标记消息；消息本身已带插件名，且 `plugin` 同时被 v2→v3 迁移白名单和 v3 `MessageSourceMap` 接受（`{ kind: 'plugin'; plugin: string } & ContextFormed`，其 `ContextFormed` 允许 `form` 缺省）。
- `tests/minimal-prompt.test.ts`（当时为 `tests/tool-bootstrap.test.ts`）的两个 instruction-hint 用例改为断言 `plugin`。

## Testing

- `pnpm --filter @linxin666/dsh-liangshen test`：8 个文件、102 个用例通过。
- persona schema 校验：两个被改预设文件里提取出的 persona 行配置通过本机安装的 `@deepseek-ai/dsh-persona` `Config` schema；修复前的形状被拒，报错正是报告中的 `$.prefix missing required value`。
- 日志迁移校验：用本机安装的 `sessionFormatV2ToV3` stage 处理构造的 v2 `agent/inbox/spliced` 事件，`instruction-hint` 消息被拒且报错为报告中的 `cannot safely transform unclassified message source`；同一事件把 kind 换成 `plugin` 后迁移通过并原样发出。

## Alternatives considered

- 改核心白名单加入 `instruction-hint`，而不是改插件。否决：白名单在官方 DSH 包里，本仓库不得修改 DSH checkout；该自定义 kind 也已退役，扩大契约只会保留一个没有其他使用方的名字。
- 保留 `instruction-hint`，让 `tool-bootstrap` 改写历史日志。否决：在 pre-step 钩子里重写 zstd 持久化日志不安全，且会话格式不归本仓库所有。
- 因为报告没点名模板就不动它。否决：它是新预设的文档化复制源，缺陷完全相同，只修被点名的文件会让下一个预设继续坏。

## Consequences

- 新的梁神会话持久化的来源 kind 是已发布迁移认识的，DSH 升级后可恢复。本条权衡过的 `DEFAULT_MESSAGE_SOURCES` 白名单随其所属的两阶段机制一并退役（见 [LiangShen mode as a minimal persona plus an injected standard tool catalog](../feature/2026-09-11-liangshen-minimal-prompt-tool-catalog.zh.md)）。
- 历史中已经写入 `"kind":"instruction-hint"` 的会话仍需用户自行规范化该 kind 才能打开；本次修复只防止新增，不修复既有文件。
- 复制 `_template/` 的预设作者得到的 persona 行能在当前 schema 下挂载。
