# dsh-task-board — DSH web GUI 任务看板插件

[English](README.md) | 中文

一个可热插拔的 DeepSeek Harness (DSH) Web GUI 插件，提供 Host 权威任务账本、真实 DSH 会话执行、Host cron 调度和可选的跨平台空闲睡眠保护。插件只通过 `cordis.patch.yml` 与 profile 机制挂载，不修改 DSH 源码。

- 浏览器只是异步视图；关闭页面不会停止 Host 调度或执行结算。
- 每次运行创建独立 DSH 会话，并在发送任务 Prompt 前应用钉住的工作区、agent 预设与权限。
- 可选电源保护允许显示器熄灭，同时阻止整机因空闲进入系统睡眠。

## 功能

- **任务看板 UI**：新会话按钮下方的侧边栏入口在宽栏显示图标和文字、在折叠 rail 显示图标；看板提供五列布局、搜索、任务详情、归档/恢复、执行历史和执行会话跳转。归档任务除恢复、删除和查看 transcript 外保持只读，恢复前不能手动或定时执行。
- **续接卡片（数据面）**：新建任务时可粘贴会话输出的 `<<<FREEZE … >>>FREEZE` 冻结块，解析为「目标/进度/下一步」快照随任务持久化（v3 账本）；卡片带冻结徽标，详情页可读完整快照与冻结时间，搜索覆盖快照文本，归档/恢复与普通任务一致。快照在协议层复用冻结安全门：敏感模式自动替换为 `[REDACTED]` 并标记、以 `/` 开头的命令行整体拒绝、每字段 8 KiB 上限。
- **交接包与权限确认门**：续接卡片可附交接包——钉住三元组（工作区/agent 预设/权限）加文档与脚本引用。执行时交接包三元组覆盖普通钉住字段，引用以交接前言随 Prompt 下发。有效权限高于 `sessionDefaultPermission`（默认 `read-only`）的绑定处于待确认状态：手动执行被拒绝、cron 跳过该卡并滚动到下一触发点，任务详情中的确认按钮完成人工确认；此后任何权限或交接包变更都会重新武装确认门。
- **领卡来源声明包裹与来源审计**：执行续接卡片（带冻结快照的卡片）时，任务指令被来源声明模板强制包裹——冻结时间、来源会话与未经人工审查提示，组合在交接前言之后，使接手 Agent 对卡片文本中的存储型提示注入保持警惕。create/update 动作的发起方会话织入快照（frozenBy，快照被替换时重新盖章），run/rerun 的发起方会话连同冻结来源的捕获副本一起落在执行记录（initiatedBy）上，两者均可在任务详情查看。发起方为客户端断言的审计元数据，不构成信任边界。
- **Host 权威账本**：任务、计划和执行记录存于 `$DSH_HOME/task-board/ledger-v2.json`；浏览器动作只有经 Host 确认后才成为 UI 状态。
- **有界执行历史**：每个任务只保留最近 20 条执行记录；新运行开始时截掉最旧的记录，使账本大小与每次写入成本不随任务历史无限增长。
- **真实执行**：手动运行和定时运行共用 Host runner，新建独立会话、重命名、应用 agent 预设和 `/permission <id>`，再以 queue 模式发送任务 Prompt。
- **钉子失败即关闭**：工作区缺失、预设缺失或损坏、权限命令被拒绝时，任务 Prompt 不会发送。
- **Host 调度器**：5 段 cron 支持 `*`、`*/n`、范围、逗号列表、周日 `0/7` 和标准的日期/星期 OR 语义，时间基准为 Host 本地时区。
- **确定性恢复**：已有 session id 的 running execution 在重启后继续观察；没有 session id 的启动中断会取消且不会重发。
- **实时同步**：变更返回完整 revision snapshot；SSE 只提示 revision、scheduler 与 power 变化，重连和页面恢复可见时重新拉完整 snapshot。
- **可选空闲睡眠保护**：默认关闭；开启后覆盖全部运行中的 DSH 会话、已启用且未归档的任务计划和未知会话状态。
- **系统提示词注入**：Host 通过 `SystemPrompt.section` 注册 order 200 的 `plugin:task-board` 段；任务看板设置可单独关闭声明而不关闭看板。该提示也会提醒 agent 在最终回复前收尾可见的 `todo_write` 计划列表。

## 架构与协议

- `src/index.ts` 通过官方 `@deepseek-ai/dsh-api-gateway`、`@deepseek-ai/dsh-workspace` 与 `@deepseek-ai/dsh-host-webserver` SDK 挂载 Host 服务。
- `src/host-ledger.ts` 串行动作，并用临时文件加原子 rename 持久化 `{ schemaVersion: 3, revision, tasks, scheduler, recentRequests }`。
- `src/host-service.ts` 负责 cron tick、错过触发跳过、runner 启动、重启对账和电源保护理由。
- `src/client/host-api.ts` 单次导入旧浏览器数据、提交幂等动作，并把 Host snapshot 当作唯一已确认 UI 状态。
- 同源接口为 `GET /api/task-board/state`、`GET /api/task-board/events` 和 `POST /api/task-board/action`。
- 所有接口都要求浏览器同源标记。直接访问只允许 DSH loopback origin；同机认证反向代理必须使用显式 Host 白名单和服务端注入 token。POST 还必须为 JSON。普通动作上限 64 KiB，导入上限 2 MiB。action 联合中没有命令、可执行路径、shell 文本或任意参数字段。

## 安装

安装聚合包或单独安装本包，然后重启 `dsh web`：

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-task-board@latest
```

本地开发安装：

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install
pnpm build
dsh plugin --profile web add link:$(pwd)/packages/dsh-task-board
```

## 配置

| 键 | 默认值 | 行为 |
| --- | --- | --- |
| `enabled` | `true` | 启用 Host 服务与浏览器看板。 |
| `announceToAgent` | `false` | 按需开启：开启后向 agent 系统提示加入任务看板说明。 |
| `preventIdleSleep` | `false` | 存在运行中的 DSH 会话、已启用计划或未知会话状态时，持有一个系统空闲睡眠断言。 |
| `trustedProxyHosts` | `[]` | 仅通过已认证 loopback 反向代理路径接受的规范 `host[:port]` authority 白名单。 |
| `proxyTokenEnv` | `DSH_TASK_BOARD_PROXY_TOKEN` | 保存反向代理 token 的环境变量名；token 本身不会写入插件配置。 |
| `sessionDefaultPermission` | `read-only` | 部署的会话默认权限。卡片有效权限（交接包或钉住字段）高于该值时，运行前必须经人工确认；cron 拒绝调度待确认卡片。 |

浏览器直接访问仍限制为 DSH loopback origin。若使用同机认证反向代理，应让 DSH Web 绑定 loopback，配置 `trustedProxyHosts`，在 `proxyTokenEnv` 指定的环境变量中放置高熵 token，并让代理在完成认证后替换（不能透传客户端提供的）`X-Dsh-Task-Board-Proxy-Token`。代理 Host 必须在白名单内，浏览器 `Origin` 必须与其 authority 相同。修改这些 composition 级代理设置后需重启 Host。

macOS 后端启动 `/usr/bin/caffeinate -i -w <host-pid>`，绝不请求 `-d`。Windows 后端从 `SystemRoot` 启动绝对路径的 Windows PowerShell，固定 helper 只请求 `ES_CONTINUOUS | ES_SYSTEM_REQUIRED`；不请求 `ES_DISPLAY_REQUIRED`，不修改电源计划，也不需要管理员权限。Linux 后端只从 `/usr/bin/systemd-inhibit` 或 `/bin/systemd-inhibit` 启动 systemd-logind `idle` block inhibitor，不请求 `sleep`、`handle-lid-switch` 或显示器/屏保 inhibitor；没有 systemd-logind 时显示 `unsupported` 或可见错误，不启动桌面环境专用替代命令。其他平台报告 `unsupported`。

## 数据存储与迁移

- 权威账本文件固定为 `$DSH_HOME/task-board/ledger-v2.json`（文件名为历史沿用）；当前文档 schema 为 v3，v2 文档会在下一次 Host 启动时逐字段无损迁移为 v3 并原地写回。POSIX 新文件权限为 `0600`；Windows 继承用户目录 ACL。
- v2 到 v3 迁移失败（任务行结构非法）时失败关闭并报出明确错误，原文件保持不动；绝不静默以空账本重启。损坏或未知 schema 的文件会移动到防碰撞的 `ledger-v2.json.corrupt-*` 名称，Host 以空账本和可见 scheduler 错误启动，不覆盖损坏字节。
- 每个 origin 首次加载新版页面时，按稳定 source id 和 request id 导入 `dsh.taskBoard.v1`。任务按 id 合并，浏览器端严格较新的顶层字段优先，时间戳相同时保留 Host 字段，执行记录按 execution id 合并。
- 最近 256 个 request id 与动作的 SHA-256 指纹会随账本持久化，因此 Host 重启后的变更重试仍保持幂等，且不会复制完整动作载荷。
- 只有导入成功并经 Host 确认后，`dsh.taskBoard.v2.hostImported` 才保存当前 Host 账本 generation；新建或损坏恢复出的新 generation 会再次接收保留的 v1 数据。v1 localStorage 原值保持不变，作为只读回退备份。
- 同一时间只有一个 Host 进程能通过 `$DSH_HOME/task-board/ledger-v2.lock` 持有任务看板账本目录；第二个使用同一 DSH home 的 Host 会失败关闭，不并发写账本。

## 安全模型

- 插件仍处在 DSH Web 既有部署与网络边界内，不返回宽松 CORS 头。state、action 与 SSE 共用同一访问栅栏；裸本地命令行请求不会被当作浏览器请求接受。
- 所有变更载荷使用严格、版本化的判别联合；浏览器不能写入 scheduler 独占时间戳或 execution 结果。
- 工作区、预设、权限、cron、任务状态和导入记录都会在 Host 再校验。
- 卡片有效权限高于配置的会话默认值时进入待确认状态：人工确认该确切绑定之前，Host 拒绝手动执行与 cron 触发；变更钉住权限或交接包会清除确认（封死先确认后替换的提权路径）。
- 任务 Prompt 是发给 DSH agent 会话的数据。协议不接受 shell 命令、PowerShell 正文、可执行路径或可配置 helper 参数。
- 电源 helper 使用固定可执行路径、固定参数、`shell: false`，失败后按 1、2、5、10、30 秒有界退避。Linux helper 通过 Host stdin 生命周期退出，使 systemd inhibitor 随 Host 异常退出自动释放。

## 构建与测试

需要 Node 20 或更高版本及官方 NPM SDK 包；不使用 DSH 源码 checkout。

```sh
pnpm --filter @linxin666/dsh-client-ui-task-board typecheck
pnpm --filter @linxin666/dsh-client-ui-task-board test
pnpm --filter @linxin666/dsh-client-ui-task-board build
```

设置 `DSH_POWER_SMOKE=1` 可在 Windows、macOS 或 Linux 上显式启用原生 helper smoke：真实启动固定 helper、等待 ready、在清理路径释放并确认进程退出，不修改系统电源计划。Linux 会先以有界超时探测 systemd-logind；没有可用 system bus 时原生部分跳过，纯逻辑测试仍可运行。

## 手工验证

1. 挂载插件并重启 `dsh web`，打开任务看板，确认 Host 时区和电源状态可见。
2. 新建并编辑任务；刷新或打开第二个同源标签页，确认两者显示同一 Host revision。
3. 执行一个钉住工作区、预设和权限的任务；确认出现新会话，并由该会话的 `turn/end` 历史结算任务。
4. 启用一个即将到期的 cron，关闭全部浏览器页面，确认 Host 仍只创建并结算一次 execution。
5. 让 Host 停止并错过一个 cron 触发点，重启后确认该次被跳过，`nextRunAt` 从当前 Host 时间向后滚动。
6. 开启 `preventIdleSleep` 并运行长任务，让显示器自动熄灭；恢复显示后确认会话继续且 execution 已结算。
7. 关闭设置并禁用所有计划，再停止 DSH，确认 helper 退出；macOS 可用 `pmset -g assertions` 辅助确认插件没有 display-sleep assertion。
8. Linux 可用 `systemd-inhibit --list` 确认只存在 `idle`/`block` 条目；显示器仍按桌面设置关闭，手动睡眠和合盖仍由系统策略处理。

## 已知限制

- Host 停止、系统睡眠或长暂停期间错过的触发点会跳过，绝不排队补跑。
- 同一任务已在运行时会跳过到期出现并滚动到下一 cron 匹配点；任务运行不并发、不排队。
- DST 采用 Host 本地墙上时钟语义：春季跳时中不存在的分钟会跳过，秋季回拨中重复的分钟不会执行第二次。
- 电源保护只阻止空闲系统睡眠，明确允许显示器睡眠与锁屏。
- 合盖、手动睡眠、休眠、关机、低电量强制睡眠和企业电源策略不在保证范围内。
- 插件不创建唤醒定时器，也不能唤醒已经睡眠的机器。
- Linux 需要 systemd-logind 及允许当前用户取得 idle block lock 的策略；容器、WSL、无 system bus 或非 systemd 系统可能显示 `unsupported` 或 `error`。桌面环境是否把 logind idle lock 与显示器空闲联动属于其自身策略，插件不请求屏保或显示器 inhibitor。
- 已启用计划会从未来触发点之前持续持锁，因此可能增加电池消耗。
- Host 执行消耗与普通 DSH agent 会话相同的 API 额度。

## 数据遥测

浏览器半区每个 UTC 日向 dsh-market.com 发送一次匿名安装心跳：仅含一个 localStorage 随机 ID 与本包名，无其他数据。服务端只存储该 ID 的加盐哈希，不存 IP，且只暴露聚合计数。完整契约见 [docs/telemetry.md](../../docs/telemetry.md)。
