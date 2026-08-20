# AGENTS.md — dsh-chat-recovery

DSH Web GUI 的对话恢复插件（编辑最近消息 + 轮次重试监督）。包级规则：只写本包特有
约定，不重复根 AGENTS.md 与 packages/AGENTS.md 的全局/包级规则。

## 本包要点

- 纯浏览器插件：host 半区是 no-op（cordis.patch.yml 行 id ui-chat-recovery）；
  功能全部在 src/client，跨半区共享的纯逻辑放 src/core（transcript / retry-policy /
  retry-supervisor），一律框架无关、依赖注入，便于单测。
- **两条机制都走 fork**：编辑与重试绝不改原会话，只从「受影响消息之前」的
  turn/end 前缀切子分支（首轮退化为同工作区空白会话），再 prompt 一次原文。
  任何情况下不得在同一会话重复 prompt 同一文本（重复消息防护）。
- **重试保守性**：涉及工具/命令的轮次、不可重试错误（鉴权/权限/非法参数/配额/
  取消）、用户主动停止、输出上限一律不自动重试，只给手动按钮；主机自身的
  llm/retry 链 scheduled/started 期间必须让位（hostRetryPending）。
- **槽位**：编辑+重试按钮注册 conversation.chat.turnTail（chain，selector 无法读
  快照，因此匹配每一轮、组件内过滤）；重试状态行注册 conversation.input.dock。
- 文案双语经 ctx.locale.register('chat-recovery', { zh, en })；zh 为 key 源。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-chat-recovery typecheck
pnpm --filter @linxin666/dsh-chat-recovery test
pnpm --filter @linxin666/dsh-chat-recovery build
```
