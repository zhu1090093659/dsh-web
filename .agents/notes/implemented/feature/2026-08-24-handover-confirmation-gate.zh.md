# Agent Note：交接包 + 权限人工确认门（工单 #5）

状态：已实现

## 问题

ADR 0001 的第二项能力：续接卡片须能携带交接包（钉住三元组 + 文档/脚本引用），且有效权限高于会话默认时绝不可无人执行——封死对抗性审核场景 b（低权限建卡者让高权限卡片经手动或 cron 运行的提权通道）。

## 决策

- `TaskRecord` 新增 `handover?: TaskHandover`（workspaceId/mode/permission + 有界 `references`，打点 `bundledAt`）与 `permissionConfirmedAt?: number`。领域逻辑集中在 `core/handover.ts`：`sanitizeHandover`（精确键、字符串目标、已知权限、32 条引用 / 每条 512 B / 总量 8 KiB）、`effectivePermission`（交接包覆盖普通钉住）、`requiresPermissionConfirmation`（既高权又未确认）、以及相对 `DEFAULT_SESSION_PERMISSION = 'read-only'` 的 `PERMISSION_RANK` 高权序。
- `protocol.ts` 在 create 输入与 update patch 上接受 `handover`（null 清除，与 freeze 一致），新增 `confirm-permission` 动作；脱敏后的包原地替换线上值。导入白名单经 `parseLedger` 归一化放行交接包，但剥除 `permissionConfirmedAt`——import 不是人工确认动作，高权绑定导入后重新武装确认门（审查加固见 `2026-08-24-review-hardening.zh.md`）。
- Host 账本对未确认高权卡拒绝 `run`/`rerun`（`confirmation-required`）；`openScheduled`（cron）跳过该卡并滚动 `nextRunAt`（与已运行拒绝同路径）；新增 `confirm-permission` 分支打 `permissionConfirmedAt` 戳。比较基线是账本的 `sessionDefaultPermission` 选项，由新插件配置键（schema 默认 `read-only`，fail-safe）经 `TaskBoardHostService` 接线，并随每个 snapshot 下发给 UI 侧门控。
- 重新武装语义：确认绑定的是确切的权限值。`applyUpdateTask` 在权限真实变化或交接包任何变化（含清除）时清掉 `permissionConfirmedAt`——先确认后换权无法把旧确认带到新的更高权限上。
- `HostExecutionRunner.launch` 先解析有效三元组（交接包优先于钉住）再校验；交接包携带引用时在 Prompt 前拼接交接前言（引用 + 打包时间）。
- UI：新建弹窗增加引用文本域（有行则把所选三元组作为包附上）；任务详情展示交接包区块（三元组 + 引用 + bundledAt）、带确认按钮的待确认横幅（`controller.confirmPermission`）与已确认戳。store 归一化只丢畸形包或戳，绝不丢任务行。

## 备选方案

- 仿 remote-web-ui approval 事件的独立待审批队列——本工单否决：Host 账本事务模型已提供幂等、持久的状态；任务行上的戳加一个显式人工动作就是同构的"待确认事务"，且只有一个事实源。
- 写入时拦截高权卡片——否决：需求是确认后执行而非拒绝；建卡必须保持可行（交接包正是把工作交给更高权限操作者的方式）。
- 从运行时 API 读取会话默认权限——暂缓：当前 SDK 无此接口；配置键让门控保持保守（read-only 默认意味着任何写权限提升都需确认一次）。

## 后果

- cron 拒绝复用滚动路径：待确认的定时卡保持排程武装但确认前绝不触发——不执行、不排队。
- `sessionDefaultPermission` 是部署声明的值；部署把它设得高于真实会话默认时，差值区间的门控会变弱（已在 README 配置表说明）。
- 会话内冻结生成入口（agent 产出 `<<<FREEZE` 块）仍开放；当前交接包经 UI/协议附上。

## 验证

`pnpm --filter @linxin666/dsh-client-ui-task-board typecheck/test/build` 通过（274 项测试；新增 `tests/handover-confirm.spec.ts` 覆盖协议门、用例打点/重新武装、store 归一化、未确认拒绝执行、确认后执行、默认权限放行、cron 拒绝 + 滚动、确认后 cron 触发、runner 覆盖/前言；`tests/handover-ui.spec.tsx` 覆盖详情横幅、确认按钮与已确认戳）。README 配对更新后 `pnpm docs:check` 通过。
