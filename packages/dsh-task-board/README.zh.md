# dsh-task-board — DSH web GUI 任务看板插件

[English](README.md) | 中文

一个可热插拔的 DeepSeek Harness (DSH) Web GUI 插件，提供 Host 权威任务账本、真实 DSH 会话执行、Host cron 调度和可选的跨平台空闲睡眠保护。插件只通过 `cordis.patch.yml` 与 profile 机制挂载，不修改 DSH 源码。

- 浏览器只是异步视图；关闭页面不会停止 Host 调度或执行结算。
- 每次运行创建独立 DSH 会话，并在发送任务 Prompt 前应用钉住的工作区、agent 预设与权限。
- 可选电源保护允许显示器熄灭，同时阻止整机因空闲进入系统睡眠。

## 功能

- **任务看板 UI**：新会话按钮下方的侧边栏入口在宽栏显示图标和文字、在折叠 rail 显示图标；看板提供五列布局、搜索、任务详情、归档/恢复、执行历史和执行会话跳转。
- **Host 权威账本**：任务、计划和执行记录存于 `$DSH_HOME/task-board/ledger-v2.json`；浏览器动作只有经 Host 确认后才成为 UI 状态。
- **真实执行**：手动运行和定时运行共用 Host runner，新建独立会话、重命名、应用 agent 预设和 `/permission <id>`，再以 queue 模式发送任务 Prompt。
- **钉子失败即关闭**：工作区缺失、预设缺失或损坏、权限命令被拒绝时，任务 Prompt 不会发送。
- **Host 调度器**：5 段 cron 支持 `*`、`*/n`、范围、逗号列表、周日 `0/7` 和标准的日期/星期 OR 语义，时间基准为 Host 本地时区。
- **确定性恢复**：已有 session id 的 running execution 在重启后继续观察；没有 session id 的启动中断会取消且不会重发。
- **实时同步**：变更返回完整 revision snapshot；SSE 只提示 revision、scheduler 与 power 变化，重连和页面恢复可见时重新拉完整 snapshot。
- **可选空闲睡眠保护**：默认关闭；开启后覆盖全部运行中的 DSH 会话、已启用的任务计划和未知会话状态。

## 架构与协议

- `src/index.ts` 通过官方 `@deepseek-ai/dsh-host-apiproxy` 与 `@deepseek-ai/dsh-host-webserver` SDK 挂载 Host 服务。
- `src/host-ledger.ts` 串行动作，并用临时文件加原子 rename 持久化 `{ schemaVersion: 2, revision, tasks, scheduler }`。
- `src/host-service.ts` 负责 cron tick、错过触发跳过、runner 启动、重启对账和电源保护理由。
- `src/client/host-api.ts` 单次导入旧浏览器数据、提交幂等动作，并把 Host snapshot 当作唯一已确认 UI 状态。
- 同源接口为 `GET /api/task-board/state`、`GET /api/task-board/events` 和 `POST /api/task-board/action`。
- POST 必须为 JSON 且 exact same-origin；没有 `Origin` 的请求只允许 loopback。普通动作上限 64 KiB，导入上限 2 MiB。严格 action 联合中没有命令、可执行路径、shell 文本或任意参数字段。

## 安装

安装聚合包或单独安装本包，然后重启 `dsh web`：

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-task-board
```

本地开发安装：

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install
pnpm build
dsh plugin --profile web add link:$(pwd)/packages/dsh-task-board
```

## 配置

| 键 | 默认值 | 行为 |
| --- | --- | --- |
| `enabled` | `true` | 启用 Host 服务与浏览器看板。 |
| `announceToAgent` | `true` | 向 agent 系统提示加入任务看板说明。 |
| `preventIdleSleep` | `false` | 存在运行中的 DSH 会话、已启用计划或未知会话状态时，持有一个系统空闲睡眠断言。 |

macOS 后端启动 `/usr/bin/caffeinate -i -w <host-pid>`，绝不请求 `-d`。Windows 后端从 `SystemRoot` 启动绝对路径的 Windows PowerShell，固定 helper 只请求 `ES_CONTINUOUS | ES_SYSTEM_REQUIRED`；不请求 `ES_DISPLAY_REQUIRED`，不修改电源计划，也不需要管理员权限。Linux 和其他平台报告 `unsupported`，不会启动替代命令。

## 数据存储与迁移

- v2 账本位于 `$DSH_HOME/task-board/ledger-v2.json`。POSIX 新文件权限为 `0600`；Windows 继承用户目录 ACL。
- 损坏的 v2 文件会移动为 `ledger-v2.json.corrupt-<timestamp>`，Host 以空账本和可见 scheduler 错误启动，不覆盖损坏字节。
- 每个 origin 首次加载新版页面时，按稳定 source id 和 request id 导入 `dsh.taskBoard.v1`。任务按 id 合并，较新的顶层字段优先，执行记录按 execution id 合并。
- 只有 Host 确认后才写 `dsh.taskBoard.v2.hostImported` 标记。v1 localStorage 原值保持不变，作为只读回退备份。

## 安全模型

- 插件仍处在 DSH Web 既有部署与网络边界内，不返回宽松 CORS 头。
- 所有变更载荷使用严格、版本化的判别联合；浏览器不能写入 scheduler 独占时间戳或 execution 结果。
- 工作区、预设、权限、cron、任务状态和导入记录都会在 Host 再校验。
- 任务 Prompt 是发给 DSH agent 会话的数据。协议不接受 shell 命令、PowerShell 正文、可执行路径或可配置 helper 参数。
- 电源 helper 使用固定可执行路径、固定参数、`shell: false`，失败后按 1、2、5、10、30 秒有界退避。

## 构建与测试

需要 Node 20 或更高版本及官方 NPM SDK 包；不使用 DSH 源码 checkout。

```sh
pnpm --filter @linxin666/dsh-client-ui-task-board typecheck
pnpm --filter @linxin666/dsh-client-ui-task-board test
pnpm --filter @linxin666/dsh-client-ui-task-board build
```

仓库 CI 另在 `windows-latest` 与 `macos-latest` 运行 opt-in 原生 helper smoke：真实启动固定 helper、等待 ready、释放并确认进程退出，不修改系统电源计划。

## 手工验证

1. 挂载插件并重启 `dsh web`，打开任务看板，确认 Host 时区和电源状态可见。
2. 新建并编辑任务；刷新或打开第二个同源标签页，确认两者显示同一 Host revision。
3. 执行一个钉住工作区、预设和权限的任务；确认出现新会话，并由该会话的 `turn/end` 历史结算任务。
4. 启用一个即将到期的 cron，关闭全部浏览器页面，确认 Host 仍只创建并结算一次 execution。
5. 让 Host 停止并错过一个 cron 触发点，重启后确认该次被跳过，`nextRunAt` 从当前 Host 时间向后滚动。
6. 开启 `preventIdleSleep` 并运行长任务，让显示器自动熄灭；恢复显示后确认会话继续且 execution 已结算。
7. 关闭设置并禁用所有计划，再停止 DSH，确认 helper 退出；macOS 可用 `pmset -g assertions` 辅助确认插件没有 display-sleep assertion。

## 已知限制

- Host 停止、系统睡眠或长暂停期间错过的触发点会跳过，绝不排队补跑。
- 同一任务已在运行时会跳过到期出现并滚动到下一 cron 匹配点；任务运行不并发、不排队。
- 电源保护只阻止空闲系统睡眠，明确允许显示器睡眠与锁屏。
- 合盖、手动睡眠、休眠、关机、低电量强制睡眠和企业电源策略不在保证范围内。
- 插件不创建唤醒定时器，也不能唤醒已经睡眠的机器。
- 已启用计划会从未来触发点之前持续持锁，因此可能增加电池消耗。
- Host 执行消耗与普通 DSH agent 会话相同的 API 额度。
