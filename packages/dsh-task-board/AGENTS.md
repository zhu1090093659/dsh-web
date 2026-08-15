# AGENTS.md — dsh-task-board

dsh Web GUI 的多列任务看板（UI 类插件）。任务可**真实执行**，不是假状态。

## 真实执行与定时调度

- 执行走 host 半区会话机制：`core/execution.ts` 通过 workspaces 服务接入一个真实
  session（blank-session 复用或 `session.create`）、重命名为任务标题、以
  `session.prompt` 发任务提示，再订阅会话快照直到本轮 settle。**执行消耗 API
  额度**，执行前先确认。
- 定时调度在浏览器端：`core/scheduler.ts` 每 60s 心跳（+ 标签页恢复即时补 tick），
  命中 cron 到期即触发，提前滚动到下一次匹配避免同 tick 双发。
- 纯浏览器调度，**无服务端通道**：需 GUI 标签页打开才行，错过即跳过（不排队）；
  正在运行的任务到点被 runTask guard 拒绝，等下一次 cron。运行时人脸以结构接口注
  入，测试直接驱动 tick，无定时器。

## 数据模型

- 任务账本存浏览器 `localStorage`，键 `dsh.taskBoard.v1`（版本化）；跨刷新与
  dsh 重启存活（同源）。改键或字段必须在 `core/store.ts` 的解析/修复逻辑同步
  处理旧数据。
- 任务可钉住执行目标（`workspaceId` / `mode` / `permission`，均可选，缺省即
  运行时默认）：旧数据无这些字段，靠 store 规范化兜底；执行侧应用不了的目标在
  prompt 前失败（见 `core/execution.ts` 的 applyMode/applyPermission）。
- 新增源码文件落区：host 面不适合此包（看板为纯 client + core），执行/调度逻辑进
  `core/`，UI 进 `client/board/`。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-client-ui-task-board test
pnpm run typecheck
pnpm run build
```
