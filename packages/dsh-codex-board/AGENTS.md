# AGENTS.md — codex-board

DSH web GUI 的 Codex 风格悬浮任务看板。包级规则：只写本包特有约定，不重复根
AGENTS.md 与 packages/AGENTS.md 的全局/包级规则。

## 本包要点

- 悬浮看板固定在 GUI 右上角（document.body 直接挂载，无会话槽位），实时镜像
  当前会话的 todos 投影（`todo_write` 工具写入，host 折叠为
  `session/projection` 帧，客户端经 `sessions.binding(id).session.projections.faceOf('todos')`
  订阅）。标题显示 完成数/总数 与进度条，每行三态标记（pending /
  in_progress / completed），可折叠（按会话持久化于 localStorage）。
- 目录分区：`src/index.ts` 是 host 半区（仅注入系统提示段，声明插件存在）；
  `src/client/` 是 browser 半区（CodexBoard 组件 + apply 接线）；
  `src/core/derive.ts` 是两侧共享的纯派生逻辑（进度计算 / 折叠持久化）。
- 语义属性：根容器 `data-dsh-plugin="codex-board"`，部件用裸值
  `data-dsh-part`（root / header / progress / row），枚举见
  skins/skin-center/contracts/semantic-attrs-v1.md。
- 看板只在「有会话且 todos 投影非空」时渲染；新会话屏 / 空列表不占位。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-client-ui-codex-board typecheck
pnpm --filter @linxin666/dsh-client-ui-codex-board test
pnpm --filter @linxin666/dsh-client-ui-codex-board build
```
