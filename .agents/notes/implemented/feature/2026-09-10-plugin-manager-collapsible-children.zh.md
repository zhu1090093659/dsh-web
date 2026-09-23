# Agent Note: 插件管理页聚合包子插件列表折叠

Status: implemented

## Problem

`@linxin666/dsh-web-all` 这类聚合包声明 40+ 条入口行，其中 20+ 条是用户可见的家族插件。issue #1439：插件管理页把每条子行都平铺在所属包行下面，于是每装一个聚合包就给设置页加 20+ 行开关，把内置产品开关推到很下面。

## Decision

子插件列表改为默认收起的展开面板：所属行渲染一个带「子插件 N/M 已启用」摘要（`childrenSummary`）的切换按钮，`aria-expanded` 与 `aria-controls` 指向列表；子行与 `childrenHint` 说明只在展开时渲染。每次挂载都从收起状态开始，每个父行按所属插件 id 独立展开。

## Alternatives considered

- 原生 `<details>/<summary>`：拿不到受控的 `aria-expanded`，且摘要文本本来就要跟随 React 行模型（计数与锁定行提示）。
- 把展开状态持久化到 `localStorage` 或 profile：默认收起已满足诉求，且不引入新的持久化面。
- 子行开关进行中自动展开：该行本来就会用返回的父行刷新，摘要在不展开的情况下也会更新。

## Consequences

- `children === []` 的行既不渲染切换按钮也不渲染说明（旧代码会渲染空列表加说明）。
- 父行的 `enabled`/`disabled`/`mixed` 标签、子行开关语义、`data-plugin-row` 锚点、核心行的 `lockedRowHint` 全部不变，只有可见性变化。
- 计数直接来自该页已经渲染的行，子行开关经由既有的「用返回的父行刷新」路径更新它。

## Testing

`packages/dsh-plugin-manager/tests/PluginManagerTab.spec.tsx`：默认收起与摘要、展开/收起往返、不同父行互不影响、子行开关仍调用 `setEnabled(entryId, false)` 且摘要刷新为 `1/2`。门禁：`pnpm --filter @linxin666/dsh-client-ui-plugin-manager test`、`typecheck`，以及针对新增 zh/en/ru 键的 `pnpm i18n:check`。
