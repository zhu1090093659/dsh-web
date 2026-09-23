# Agent Note: 任务面板支持复制与修改新建副本 (Issue #1413)

状态: 已实现

## 问题背景

在任务面板（task-board）中，用户经常需要配置包含详细 Prompt 指令、执行选项（工作区、智能体模式、权限级别、模型）及 Cron 定时规则的复杂任务。在此前版本中缺乏任务复制能力：
1. 想要基于历史完成或失败的任务再次运行或微调时，必须手动重新输入全部 Prompt、描述与运行时配置；
2. 针对类似任务进行分支创建时操作繁琐，容易遗漏关键参数；
3. 创建新任务后，用户往往需要手动找到并归档旧任务，操作链路割裂。

## 决策方案

在任务详情面板和新建任务模态框中实现完整的「复制为新任务 / 修改并新建副本」工作流：

1. **详情栏操作集成 (`TaskDetail.tsx`)**：
   - 在任务详情操作栏中增加「修改并新建副本 / 复制为新任务」操作按钮；
   - 点击后呼出携带原任务模板（`initialTask`）的 `NewTaskModal`。
2. **模板表单回填与副本自适应 (`NewTaskModal.tsx`)**：
   - 自动回填标题、描述、Prompt、工作区、智能体模式、权限级别、模型及 Cron 规则；
   - 标题自适应追加「（副本）」标识；
   - 清除历史执行记录与运行时 ID，以独立干净状态新建；
   - 提供「创建后归档原任务」复选框（默认勾选），实现一键更替。
3. **多语言对齐 (`locales.ts` 与 `dsh-i18n`)**：
   - 严格对齐 `detail.duplicate`、`detail.duplicateAndEdit`、`new.duplicateTitle`、`new.archiveOriginal` 的中、英、俄三语字典。

## 测试验证

- 新增 `packages/dsh-task-board/tests/task-duplicate.spec.ts`，验证表单全字段回填、自适应副本标题、原任务归档联动及控制器调用；
- `dsh-task-board` 全量 35 个测试套件、318 项单元测试全部通过；
- 通过 `pnpm typecheck`、`pnpm i18n:check`、`pnpm docs:check`、`pnpm test`。

## 影响

用户可一键克隆或基于旧任务微调创建新任务，完整保留复杂执行环境配置并支持自动归档前序任务。
