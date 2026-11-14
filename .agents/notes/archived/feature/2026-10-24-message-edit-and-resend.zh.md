# Agent Note: 文本消息编辑重发使用精确前缀 fork

Status: implemented
Archived: 2026-11-14

替代关系检查：[better-session-replaces-chat-recovery](../architecture/2026-08-27-better-session-replaces-chat-recovery.md) 曾因与 better-session 重叠而让旧的最后消息编辑器退役，[drop-deprecated-better-session-integration](../simplification/2026-09-02-drop-deprecated-better-session-integration.md) 后来又移除了那个外部集成。本决定不逆转其中任何一项：`dsh-chat-recovery` 及其重试监督器保持退役，better-session 保持移除。本 Note 归属 `dsh-message-edit` 这项独立的任意历史回合、纯文本编辑能力。

## Problem

发错或有歧义的用户消息会与后续全部工具结果一起留在 append-only 会话历史中，继续原会话就会保留错误上下文；另开会话手工重建前缀又会丢失有用历史。原生界面没有任何操作能编辑较早的用户消息并恰好从它之前恢复。

## Decision

`@linxin666/dsh-client-ui-message-edit` 在每个含普通、非空、纯文本用户消息的回合，向官方 `conversation.chat.turnTail` 列表添加一个入口，不替换 keyed 用户渲染器。编辑器保留原文，明确提示重发会开启分支且不撤销外部副作用，支持 Ctrl/Cmd+Enter 与 Escape；会话运行中、已移除或访问方没有 `session/fork` 权限时禁止提交。

提交只使用官方客户端服务：`sessions.fork({ sessionId, atSeq: message.seq - 1, increaseTitle: true })`，以 `messageEdit` 归属标签建立短期 `sessions.using` 引用，等待 `reference.ready`，调用 `uiWorkspace.openSession(childId)`，再把编辑原文入队一次。包含式边界始终是真实的前一事件，首条用户消息之前则是事件 0；没有空白会话退路，也没有 Host 改动。`sessions.using` 在每条路径释放临时引用。

只有完全由文本块组成的内容可编辑。Steering、注入上下文、空消息和含附件消息不显示入口。fork 失败不导航也不 prompt；子会话创建后，后续导航或 prompt 失败不会删除它。源会话从不被重写，外部副作用从不回滚。

本包本地注册 zh/en 文案，经 `dsh-i18n` 注册 ru，并提供 `message-edit` / `entry` / `editor` 语义锚点。聚合包以 `web-ui-message-edit` 直挂真实包，不增加兼容壳子路径或存储集成。

## Alternatives considered

- **恢复带重试监督器的 `dsh-chat-recovery`**：否决。旧包只能编辑最后一条已完成用户消息，还带有本请求之外的重试行为。新包保留 fork-only 的有效前提，但可选择任意回合的普通用户消息，不含重试或持久化面。
- **替换 keyed `conversation.chat.node` 用户渲染器**：否决。重新实现官方气泡会危及 Markdown、附件、复制操作及后续行为，也会重新引入消息操作插件曾记录的渲染器 shadow 冲突。Turn-tail 列表是官方增量扩展点。
- **恢复 better-session 或就地改写日志**：否决。RDB 集成已被明确移除，本 issue 不需要存储或 Host 改动。对 append-only 事件日志而言，fork 才是正确的编辑模型。
- **丢弃非文本块后只重发文本**：否决。这会静默改变用户 prompt，因此含附件消息不提供编辑操作。

## Consequences

每次编辑都会再建一个会话分支，原会话及其后代仍然保留，频繁编辑可能留下需要用户通过正常会话管理清理的分支。分支创建后的 prompt 失败可能留下不含编辑消息的子会话；界面会暴露失败而不会静默删除子会话。富消息编辑需要另行设计附件保留语义，本能力不作此承诺。

## Testing

`packages/dsh-message-edit/tests/` 覆盖任意历史回合、首条消息边界、文本与附件准入、fork/retain/open/prompt 顺序、非法输入与失败路径、注册、编辑键盘流程、禁用状态与可见错误。聚焦类型检查、19 项单测、构建、聚合、共享副本和 i18n 检查通过。全仓与真实 GUI 证据记录在 issue #1934 的交付回帖中。
