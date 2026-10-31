# Agent Note: Task Board Card Scanability

Status: implemented

提供方来源分组现在包裹本 Note 描述的时间分组；当前主列与归档布局见 [Task board source grouping](../architecture/2026-10-31-task-board-source-grouping.zh.md)。

## Problem

接入 GitHub Issue 同步后，看板的「已完成」列有一百多张卡片，彼此几乎没有区别。每张卡片的摘要都以同样的 Issue 表单模板开头（查重勾选项、涉及插件字段、Issue 类型字段）。每张卡片都显示「更新于 4m」，因为每次同步都会刷新 `updatedAt`。最近一次执行失败、而 Issue 在上游已关闭的卡片，在「已完成」列里显示红色的「1 次执行」，看起来自相矛盾。提供方的 Issue 徽章横跨整张卡片：它是卡片纵向 flex 列的直接子元素，继承了 `align-items: stretch`。超过一天的时间标签用浏览器本地日期，而 tooltip 用 Host 时区。此外，卡片本身是一个 `<button>`，无法容纳自己的控件（打开会话、打开 Issue）。

## Decision

- **纯视图模型。** `packages/dsh-task-board/src/client/board/card-view.ts` 从任务记录推导出卡片展示的全部内容：`splitTitleKind`（方括号前缀 `[Bug]:` 变为徽章）、`cardOutcome`（色条色调与 `declared` 标记）、`cardTimeline`（该列显示哪个时刻）、`groupByRecency`（按 Host 日历分为今天 / 近 7 天 / 更早），以及按列保存的密度偏好（`dsh.taskBoard.compactColumns.v1`，已完成列默认紧凑）。这里不写账本。
- **去掉模板的摘要。** `task-markdown.tsx` 中的 `markdownExcerpt` 丢弃标题、全是勾选项的列表、原始 HTML、分隔线与空字段占位，并优先取摘要类小节的正文。标题与占位词表放在 `src/core/issue-form.ts`，因为它是关于 Issue 表单的数据，不是界面文案。全部被丢弃时回退为完整纯文本。
- **结果与时间。** 3px 左侧色条（`data-tone`）显示最近一次执行的结果。执行标签显示为「最近失败 · 1 次执行」。所在列与该次执行不一致时（失败后在已完成、成功后在已失败），再加「手动结算」并附说明 tooltip。时间标签按列显示创建时间（待规划/待办）、开始时间（未结束的执行）、结算时间（已完成/已失败）或归档时间，由 `formatCardTime` 按 Host 时区格式化。
- **article 加铺满按钮。** 卡片是承载拖拽源的 `article`。一个透明的 `button[data-dsh-part="card-open"]` 铺满卡片，作为键盘与读屏入口，其标签包含标题、执行状态、手动结算标记与标签。article 的点击处理器负责打开详情，但点击落在其他按钮或链接上时不处理。因此会话快捷按钮（`card-session`）和提供方链接各自独立生效。
- **装饰并入 meta 行。** `task-board.card.decoration` 席位在 `.cardMeta` 内以行内徽章渲染。存储的 URL 为 http(s) 时，GitHub 徽章是在新标签页打开 Issue 的 `a`，否则是普通 `span`。席位契约（`{ task }` props、list 作用域）不变。
- **长列。** 每个列头都有密度切换按钮。已完成、已失败与归档按时间分组，最新的在前。超过 30 张卡时最早一组折叠在展开按钮之后，文本或标签搜索期间从不折叠。

## Alternatives considered

**保持卡片为 `<button>`，在内部阻止事件冒泡。** 按钮里嵌套可交互元素是无效 HTML，浏览器和辅助技术的处理并不一致，提供方徽章也无法成为真正的链接。article 加铺满按钮是标准的卡片模式，并且只占一个键盘焦点位。

**通过新席位让提供方覆盖摘要。** 新席位能让 GitHub 扩展提供干净的摘要，但这是在为 Issue 表单文本这类通用问题扩展提供方契约（手工从 Issue 粘贴的卡片同样有这个问题）。看板侧的启发式规则加完整文本回退，无需改契约即可覆盖两种情况。

**只保留「更新于」，并阻止同步刷新 `updatedAt`。** 这会改变 Host、工具与提供方依赖的账本语义。按列选择时刻只是展示层的改动。

**对已完成列做虚拟滚动，而不是分组折叠。** 虚拟滚动能降低滚动成本，但读者仍要滚过一百多行几乎相同的内容。分组加密度切换解决的是阅读问题，折叠则在常见情况下限制了 DOM 规模。

## Consequences

- 以 `[data-dsh-part="card"]` 为选择器的皮肤仍然匹配。该元素现在是 `article`，所以写成 `button[data-dsh-part="card"]` 的选择器不再匹配。新增部件与属性已列入 semantic-attrs/v1 契约（dsh-skins 的 `contracts/semantic-attrs-v1.md`）。
- 看板的提供方契约不变（[任务看板扩展契约](../architecture/2026-09-30-task-board-extension-contract.md)）。装饰现在作为行内徽章与看板自己的徽章并排显示。
- 拖拽仍遵循[拖拽切换状态](2026-08-26-task-board-drag-drop-status.md)；拖拽源从按钮移到了 article。
- 密度偏好按浏览器保存，而不是按 Host；在另一台设备上从默认值开始。
- 摘要启发式只识别 `issue-form.ts` 中的标题。遇到不认识的模板时，会退化为「第一个非模板段落」，绝不会让卡片变成空白。

## Testing

`tests/card-view.spec.ts` 覆盖视图模型、日界处按 Host 时区分组、密度偏好存储与摘要。`tests/compact-card.spec.tsx` 覆盖渲染后的卡片：类型徽章、摘要、手动结算、结算时间、会话快捷按钮与紧凑密度。`tests/board-view.spec.tsx` 端到端覆盖已完成列的分组、折叠与紧凑模式。`dsh-task-board-github/tests/github-ui.spec.tsx` 覆盖 Issue 链接及其非 http 回退。

这些界面的字号尺度、结果槽位与折叠行为由[卡片界面呈现契约](2026-10-20-task-board-card-surface-contract.md)所有。
