# Agent Note: 技能中心多工作区呈现与隔离感知 (Issue #1407)

状态: 已实现

## 问题背景

在多工作区（多个项目会话并发运行）环境下，`dsh-skill-explorer` 会将所有活跃会话对应的项目技能扫描并平铺在「项目技能」分组中，存在以下体验缺陷：
1. 用户无法辨识某一项目技能具体归属于哪一个工作区；
2. 非当前活跃工作区的项目技能在当前会话中无法被模型正常调用（处于工作区隔离状态），但界面上没有任何隔离提示，极易产生困惑；
3. 当不同工作区的项目技能同名时，原先由异步扫描 resolve 的先后顺序决定胜者，缺乏确定性的优先级判定。

## 决策方案

在文件扫描收集、API 协议层及前端交互层完整引入工作区隔离感知与分工作区呈现：

1. **工作区关联与确定性胜出 (`collect.ts`)**：
   - `scanSkillRoot` 为项目技能附加 `workspaceRoot`、`workspaceName` 及 `isActiveWorkspace`；
   - 同名冲突且优先级相同时，当前活跃工作区（active workspace）技能确定性优先保留；
   - `buildPayload` 聚合所有项目根路径生成 `workspaces` 描述清单。
2. **API 协议与客户端类型 (`api.ts`)**：
   - `SkillEntry` 补充 `workspaceRoot`、`workspaceName` 与 `isActiveWorkspace`；
   - `ListPayload` 补充 `workspaces?: WorkspaceItem[]`。
3. **工作区隔离提示与筛选界面 (`SkillPanel.tsx` 与 CSS)**：
   - 为项目技能显示工作区名称徽标；
   - 非当前工作区技能醒目标记「工作区隔离」徽标，并提供悬停释义提示，卡片轻度半透明呈现；
   - 存在多个工作区时，在技能列表顶部提供工作区下拉筛选器，支持按当前工作区或指定工作区聚焦浏览。
4. **多语言对齐 (`locales.ts` 与 `dsh-i18n`)**：
   - 严格对齐 `filter.workspaceLabel`、`filter.workspaceAll`、`filter.workspaceCurrent`、`workspace.isolated` 与 `workspace.isolatedHint` 的中、英、俄三语字典。

## 测试验证

- 新增 `packages/dsh-skill-explorer/tests/workspace-isolation.spec.ts`，验证多工作区识别、同名冲突活跃工作区优先胜出、工作区徽标及隔离徽标渲染、下拉框筛选过滤；
- `dsh-skill-explorer` 全量 12 个测试套件、79 项测试全部通过；
- 通过全量质量门禁：`pnpm typecheck`、`pnpm i18n:check`、`pnpm docs:check`、`pnpm test`。

## 影响

用户可清晰分辨各项目技能的工作区归属与隔离边界，避免跨工作区调用的认知混乱。
