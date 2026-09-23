# Agent Note: 技能中心面板搜索与工作区筛选叠加（Issue #1423）

Status: implemented

## Problem

技能中心面板按来源分级展示全部已加载 skill，并可用工作区选择器筛选项目技能，
但技能数量多起来（几十个）后没有按名称查找的手段：只能滚动目视逐个翻找。
来源分组回答的是「这是谁的技能、放在哪」，不是「叫 X 的技能在哪」。面板需要
一个与既有来源分组、工作区选择叠加生效的搜索框，而不是取代它们。

## Decision

- 新增 `src/client/skill-filter.ts`：纯函数 `matchRank`（名称命中 0、
  描述命中 1、未命中 undefined）与 `selectGroups(groups, { workspace, query })`
  —— 先应用工作区轴，再应用查询，名称命中排在描述命中之前（稳定排序保留
  同档内的 host 顺序），并丢弃被筛空的来源分组。没有 workspaceRoot 的全局
  技能在任何工作区选择下都保持可见，与搜索前行为一致。
- `SkillPanel.tsx` 的 ListTab 持有 `query` 状态，渲染一个 `filter-bar`，
  内含搜索框、清空按钮与既有的工作区选择器。两者叠加后若无可显示技能，
  则显示 `filter.empty`（有查询）或 `filter.emptyWorkspace`（仅工作区），
  同时保留可操作的筛选条。筛选态下来源分组结构与启用/禁用/删除操作不变。
- 搜索框内按 Esc 清空查询但不关闭面板（面板的 document 级 Esc 处理器本就
  忽略表单控件目标）。
- i18n：zh/en 新增 `filter.searchLabel`、`filter.searchPlaceholder`、
  `filter.clear`、`filter.empty`、`filter.emptyWorkspace`，并在 `dsh-i18n`
  维护的 ru 字典中镜像。
- L2 语义属性契约新增 `filter-bar`（owner 为 skill-explorer）。
- 中英 README 同步记录搜索框及其与工作区选择的叠加关系。

## Testing

- `tests/skill-filter.spec.ts`：命中档位、大小写不敏感、空查询、与工作区的
  叠加（含全局技能保留）、空分组丢弃、输入 payload 不被修改。
- `tests/panel.spec.tsx`：输入过滤后行序为名称命中在前、空态与清空按钮
  恢复列表、Esc 清空且不关闭面板。
- 本次改动运行的门禁：包内 typecheck 与 test、`pnpm i18n:check`、
  `pnpm docs:check`。

## Alternatives considered

- 服务端搜索（list 路由加 `?q=`）：否决。数据本就在浏览器侧，往返会引入
  延迟，且纯展示层过滤没必要让 host 路由再承担一套匹配规则与测试。
- 跨分组按命中档位全局排序：否决。会破坏面板赖以存在的来源分组结构；
  排序只在分组内部进行。
- 同时匹配 `whenToUse`：暂不采纳。需求范围是名称与描述，`whenToUse` 是
  派生出的适用场景说明，会放大描述命中却没有区分度。
- 模糊匹配（Fuse.js 之类）：否决。子串匹配可预测、零依赖，面板规模是几十个
  技能而不是上千个。

## Consequences

- 找技能不再依赖滚动，且筛选与来源分组、工作区选择叠加生效。
- 面板现在区分「尚未加载任何技能」与「当前筛选下无匹配」两种空态。
- 搜索状态是组件内的临时状态，面板关闭即重置，与面板其他临时状态一致。
