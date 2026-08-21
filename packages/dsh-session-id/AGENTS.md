# AGENTS.md — session-id

DSH web GUI plugin session-id：会话 ID 查看与复制面板。包级规则：只写本包特有
约定，不重复根 AGENTS.md 与 packages/AGENTS.md 的全局/包级规则。

## 本包要点

- 纯浏览器插件：host 半区（src/index.ts）无行为；browser 半区注册
  `sidebar.footer.action`（官方 list slot，与 dsh-remote-web-ui 共享席位），
  点击打开会话 ID 面板。
- 会话数据只读官方 `ctx.sessions.list`（ObservableSnapshot），经 register 的
  `inject` 传入组件，组件用 `useSyncExternalStore` 订阅；不写任何会话状态。
- 复制走官方 `writeClipboard`（ui-primitives，平台种子表成员，允许 value
  import）；不引入其它 `@deepseek-ai/*` 值依赖。复制必须用户手势触发，
  失败显示「复制失败，请重试」可操作反馈，不申请剪贴板权限、不后台重试。
- 语义属性（semantic-attrs-v1 契约）：根容器 `data-dsh-plugin="session-id"`，
  部件 `entry` / `panel` / `row` / `copy`；新增枚举必须同步契约表。
- UI 文案 zh 为 key 源、en 完整对照（src/client/locales.ts），经
  `ctx.locale.register` 注册。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-client-ui-session-id typecheck
pnpm --filter @linxin666/dsh-client-ui-session-id test
pnpm --filter @linxin666/dsh-client-ui-session-id build
```