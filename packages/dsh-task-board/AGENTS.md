# AGENTS.md — dsh-task-board

dsh Web GUI 的 Host 权威多列任务看板。任务通过真实 DSH 会话执行，浏览器只负责异步展示与提交动作。

## Host 账本、执行与调度

- v2 权威账本固定为 `$DSH_HOME/task-board/ledger-v2.json`，结构是 `{ schemaVersion: 2, revision, tasks, scheduler }`；写入必须保持临时文件加原子 rename、损坏文件隔离和 revision 单调递增。
- 浏览器 `dsh.taskBoard.v1` 只用于一次性导入且必须保留；导入 marker 只能在 Host 确认后写。所有生产变更走 `protocol.ts` 的严格同源 action 协议，UI 不得先写未确认状态。
- 手动与 cron 统一走 `HostExecutionRunner`。钉住的 workspace、agent preset、permission 任一失效都在任务 Prompt 前 fail closed；每次 execution 创建独立会话。
- cron 使用 Host 本地时区和标准日期/星期 OR 语义。Host 首启或长暂停后的过期出现全部跳过；同任务 running 时不排队、不并发，只滚动下一触发点。
- 重启恢复时，有 session id 的 running execution 继续观察；无 session id 的启动中断标为 cancelled，禁止自动重发。

## 电源保护

- `preventIdleSleep` 默认 `false`。开启后，全部 DSH running session、任一已启用 cron 或未知 session 状态都构成持锁理由；仅在已确认无运行会话且无计划时释放。
- macOS 只允许 `/usr/bin/caffeinate -i -w <pid>`；Windows 只允许从 `SystemRoot` 解析的 Windows PowerShell 固定 helper 和 `ES_CONTINUOUS | ES_SYSTEM_REQUIRED`。Linux 只允许绝对路径 `systemd-inhibit` 的 `idle`/`block` lock，不得请求 `sleep`、显示器或 lid-switch inhibitor。
- helper 必须 `shell: false`、固定参数、不依赖 PATH、失败有界退避，并在设置关闭、插件卸载和 Host 退出时清理；不得修改电源计划或要求管理员权限。无 systemd-logind 的 Linux 和其他平台只报 `unsupported` 或可见错误。

## 文件归属与测试

- Host 协议、账本、runner、scheduler 编排和 power 状态机放 `src/`；浏览器 transport 与 UI 放 `src/client/`；纯 cron 与任务转换留 `src/core/`。
- Host 功能只依赖官方 `@deepseek-ai/*` NPM SDK，不得导入 DSH 源码。`src/dsh-home.ts` 与 `src/loopback.ts` 是 `shared/host/` 经 `scripts/sync-shared.mjs` 生成的副本，禁止手改。
- 变更账本、协议、runner、cron 或 power 时补对应单测；原生 helper 只在 `DSH_POWER_SMOKE=1` 且平台为 Windows/macOS/Linux 时运行 smoke，Linux 无可用 logind system bus 时显式跳过原生部分。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-client-ui-task-board typecheck
pnpm --filter @linxin666/dsh-client-ui-task-board test
pnpm --filter @linxin666/dsh-client-ui-task-board build
pnpm docs:check
```
