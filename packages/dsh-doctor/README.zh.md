# @linxin666/dsh-doctor

[English](README.md) | 中文

DeepSeek Harness profile 的事务式救助模式：用户级 Doctor Supervisor 与透明
Doctor Launcher 维持一份隔离救援胶囊，检测启动失败、进程崩溃、心跳丢失、Web
故障与浏览器白屏，并通过快照、确定性修复、隔离健康门禁与原子提升或回滚恢复
profile。插件默认开启：初次安装或 WebUI 版本更新后救援模式自动生效，用户在 Doctor
卡片中显式关闭的选择会被保留；可在「设置 → 插件配置 → Web 插件」的 Doctor 卡片
中切换。本插件不修改 DSH 安装。

## 能力

- Doctor Host 插件运行在每个受保护 DSH host 内：暴露 loopback 恢复 API，向
  Supervisor 上报心跳与启动阶段事实，并收集浏览器故障上报。
- Doctor Web 控制台（「设置 → 插件配置 → Web 插件」内的家族插件卡片）展示系统
  阶段、受保护 profile、故障事件与客户端故障探针，并记录已启用但从未启动的 Web UI
  插件；在启用开关旁提供诊断、修复、回滚、暂停与恢复动作以及「服务与胶囊」卡片：
  一键安装、重启升级与卸载用户级服务。
- 「发送给 Harness」窗口把最近一次故障的摘要与错误堆栈组合成排障提示词，作为新回合
  投递到当前 DSH 会话，让用户的 agent 就地诊断并修复；发送前可编辑或复制提示词。
  失败插件行同时提供一键「复制错误」与「禁用并重启」（禁用经插件管理通道写入 profile
  的启用行，宿主重启后生效）。
- Doctor Supervisor 作为用户级后台服务运行：把退出归类为用户停止、任务完成与
  真实故障，应用崩溃循环熔断，并负责救援调度。
- Doctor Launcher 会在启动 DSH 前检测旧聚合包，并在 `autoMigrate`（默认开启）且目标包可用时自动执行 `@linxin666/dsh-web-ui-all` 到 `@linxin666/dsh-web-all` 的迁移；迁移经官方 `dsh plugin` CLI 执行，带 package.json/pnpm-lock 备份和 `--dump-config` 门禁。
- Doctor Launcher 把 `dsh` 参数原样转发给真实 DSH 可执行文件，转发 stdin、
  stdout、stderr 与信号，记录启动意图与退出事实，之后才上报事件。
- 救援胶囊在机器本地目录准备固定版本 DSH 运行时、固定版本 Doctor 包与隔离的
  `DSH_HOME`，普通 overlay 或 profile patch 损坏也不会阻断恢复控制台。

profile 的 package.json 与 cordis.patch.yml 只通过官方 `dsh plugin` 命令与
文档化的 profile 层约定修改。

## 组成

| 部分 | 运行时机 | 职责 |
| --- | --- | --- |
| Doctor Host 插件 | 每个受保护 host 内 | 设置面、loopback API、心跳与客户端故障上报 |
| Doctor Web 控制台 | DSH Web GUI 内 | 启用流程、状态、事件、诊断与修复动作 |
| Doctor Supervisor | 用户级服务 | 生命周期监控、分类、熔断、救援调度 |
| Doctor Launcher | 每次 `dsh` 调用 | 透明转发参数、信号与退出事实 |
| 救援胶囊 | 机器本地隔离目录 | 固定运行时、隔离 home、离线诊断与修复工具 |

## 安装

### 从 npm 安装（全家桶优先）

```sh
dsh plugin --profile web add @linxin666/dsh-web-all@latest
```

### 独立 bundle 安装

```sh
dsh plugin --profile web add @linxin666/dsh-doctor@latest
```

### 从仓库安装（开发调试）

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install
pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-doctor
```

重启 `dsh web`，打开「设置 → 插件配置 → Web 插件」，展开 Doctor 卡片确认「启用救助模式」已开启（新安装默认开启）。
包内同时提供 `dsh-doctor` CLI：Supervisor、Launcher、胶囊配置与用户级服务适配。

## 启用

在 Doctor 卡片打开「启用救助模式」后，宿主半区挂载 `/api/doctor/*` 端点，写入当前保护策略，并在后台自动核对 Supervisor 服务、包版本、安装路径和救援胶囊；缺失或失配时执行幂等部署，不阻塞 Web 启动。关闭时宿主停止心跳并暂停 Supervisor 自动干预，但保留服务和胶囊。显式卸载会写入抑制标记，后续启动不会偷偷复活服务；用户点击「一键安装」才清除该标记。控制台按钮保留为手动重试与强制修复入口。

## 更新

更新到新版本后，先重启 `dsh web` 让宿主半区加载新代码，再在「服务与胶囊」卡片点
「重启并升级服务」（Supervisor 上报版本滞后时该按钮自动出现）：重新部署用户级服务并
重启 Supervisor 加载新代码，版本不一致时同步刷新救援胶囊。若用户更改了 provider 或密钥，
胶囊的凭据指纹会检测到差异，同一按钮也会按新配置重新镜像。若包的安装路径发生变化
（换目录、换 profile、重装），原服务记录指向旧路径，点一次「重启并升级服务」即重写
服务定义。CLI 的 `service-install` 幂等，可安全重复执行。

## CLI

`dsh-doctor` 提供运维命令：

| 命令 | 含义 |
| --- | --- |
| `dsh-doctor supervisor` | 前台运行 Supervisor |
| `dsh-doctor launch [dsh 参数...]` | 在监督下转发一次 `dsh` 调用 |
| `dsh-doctor migrate [profile]` | 直接执行确定性旧聚合包迁移 |
| `dsh-doctor status` | 以 JSON 打印 Supervisor 快照 |
| `dsh-doctor provision [profile] [--no-credentials]` | 配置或刷新救援胶囊（镜像 provider 配置与凭据、0600；默认固定当前包版本，`DSH_DOCTOR_PACKAGE` / `--no-credentials` / `DSH_DOCTOR_CREDENTIALS=off` 可调整） |
| `dsh-doctor snapshot [profile]` | 快照一个 profile |
| `dsh-doctor diagnose [profile]` | 只诊断与规划，不写文件 |
| `dsh-doctor repair [profile] --allow-live` | 运行暂存修复事务（门禁后提升） |
| `dsh-doctor rollback <txnId>` | 从隔离区恢复已提升的事务 |
| `dsh-doctor service-plan` | 打印平台服务文件与命令 |
| `dsh-doctor service-install` | 写服务文件并幂等注册服务（先注销旧注册，部署后重启） |
| `dsh-doctor service-uninstall` | 注销并删除服务文件 |

退出码：0 正常，1 已修复并验证，2 需要关注，3 被阻塞（锁、离线或缺少密钥）。

## 配置

host 设置命名空间为 `doctor`：

| 键 | 默认值 | 含义 |
| --- | --- | --- |
| `enabled` | `true` | 总开关；开启时挂载路由并自动核对部署，关闭时暂停 Supervisor 且不卸载 |
| `fullProtection` | `true` | 托管保护；发送心跳、记录故障事件并执行熔断；关闭后进入观察模式 |
| `autoRepair` | `false` | 隔离门禁通过后自动提升；关闭时保留候选并等待明确确认。同时是下方启动自愈的总开关 |
| `autoMigrate` | `true` | 启动前自动迁移旧聚合包；只对已知的 `dsh-web-ui-all` -> `dsh-web-all` 映射生效 |
| `heartbeatIntervalMs` | `5000` | host 心跳周期 |

环境变量：

| 变量 | 含义 |
| --- | --- |
| `DSH_DOCTOR_HOME` | doctor 根目录（默认 `~/.dsh-doctor`，可覆盖） |
| `DSH_DOCTOR_REAL_DSH` | 真实 `dsh` 可执行文件的绝对路径 |
| `DSH_DOCTOR_PACKAGE` | 安装救援 Doctor 用的包规格 |
| `DSH_DOCTOR_PACKAGE_DIR` | 开发时本地仓库路径 |
| `DSH_DOCTOR_CREDENTIALS` | `off` 时禁止把凭据文件镜像进救援胶囊（默认镜像） |
| `DSH_DOCTOR_ENDPOINT` | launcher 注入的 Supervisor 端点 |
| `DSH_DOCTOR_TOKEN` | launcher 注入的单次 Supervisor token |
| `DSH_DOCTOR_RUN_ID` | launcher 注入的单次启动标识 |

## 健康与恢复

| 故障 | 检测 | 默认动作 |
| --- | --- | --- |
| 启动失败 | launcher 在 ready 阶段前退出、结构化 stderr | 重试一次后进入救援 |
| 插件初始化失败 | 配置阶段非零退出 | 重试一次后进入救援 |
| 运行期崩溃 | 启动后的信号或非零退出 | 一次重启后熔断 |
| 心跳丢失 | 窗口内无心跳 | 进程与 HTTP 探测，然后救援 |
| Web 故障 | 多次 loopback HTTP 失败 | host 存活时用备用端口救援 |
| 浏览器白屏 | 客户端探针与错误边界 | 先做客户端本地恢复；有证据才记事件 |
| 用户 Ctrl+C | launcher 信号 | 正常停止，不记事件 |
| headless 业务失败 | 健康启动后非零退出 | 只报告 |

熔断器在窗口内反复失败后暂停自动重试，并把 profile 隔离等待用户明确确认。

### 启动自愈（插件级隔离）

当 profile 在失败窗口内第二次启动失败且 `autoRepair` 开启时，Supervisor 会从捕获的
stderr 归因（宿主启动报错会点名失败的 loader entry）；当能确定唯一涉事行时，向
profile 的 `cordis.patch.yml` 追加一行 `- id: <rowId>` + `disabled: true` 覆盖
（与 loader 持久化自毁插件是同一行合并机制）。下一次 `dsh web` 就能在坏插件缺席的
情况下启动，其余插件照常挂载。无法归因到单行的失败（文件错误、patch 不可解析、
宿主级故障）只标注事件；写入器拒绝禁用任何它不能证明损坏的行，从不触碰启动后才
崩溃的场景，也从不编辑解析失败的 patch 文件（那是 D-040 隔离线的职责）。每次
自愈都进 journal 与事件证据，被禁用的插件随时可以手工从 `cordis.patch.yml`
恢复。

## 修复模型

每次修复都是事务：快照当前 profile，准备候选环境，只应用确定性的规则化操作，
对候选执行隔离的 dump-config 与 Web 健康门禁，提升时把原件移入隔离区，就地验证，
失败则按字节回滚。修复引擎从不猜测：歧义情况生成候选等待确认，不安装未验证的
`latest`，不执行不可信 shell 命令。修复与回滚日志追加写盘，可跨崩溃恢复。

## 安全模型

- 全部以当前用户权限运行；不使用 root 或管理员提权。
- Supervisor 只监听本地 Unix socket（Windows 命名管道）；请求带按实例生成的
  bearer token，文件权限 0600。
- Web API 仅限 loopback，绝不把 token 交给浏览器；被拒请求返回 HTTP 403 与 `{ ok: false, error: "forbidden: loopback-only" }`。
- launcher 与 Supervisor 从不运行 shell；DSH 参数原样转发。
- 状态、日志与事件记录不写密钥；快照对凭据脱敏，脱敏层不可能恢复它们。
- 救援胶囊只绑定 loopback，除显式检查外不读取 profile home overlay。
- 救援胶囊镜像用户 profile 的设置与凭据文件（settings.yaml / .credentials.yaml /
  .env 等，0600，仅规范文件名，备份变体不镜像）；manifest 只记录文件名与内容指纹，
  绝不写密钥本身；卸载时按清单清除镜像。
- 写入范围限定在 `DSH_DOCTOR_HOME` 与包自有文件；profile 变更只经官方
  `dsh plugin` 命令。
- 一键安装、升级与卸载只经本包 CLI 以参数数组发起（launchctl / systemd --user /
  schtasks），从不启用 shell。

## 已知限制

- 用绝对路径直接调用真实 `dsh` 可执行文件会绕过 launcher；保护覆盖 launcher
  启动的运行，被绕过的 host 会报告为部分托管。
- Linux 无用户 systemd 管理器时，服务回退为登录自启包装，在最后一次登出后停止。
- 机器级损坏（Node 二进制无法加载、home 不可写、卷不可用）无法自动修复；控制台
  会给出 CLI 恢复指引。
- 快照默认只在本机使用；跨机器恢复需要导出产物与独立凭据 vault。
- Windows 对 junction、PowerShell 5.1 Unicode 与用户级计划任务为尽力支持；部分
  内部逻辑假定 POSIX 文件语义。

## 数据遥测

浏览器半区每个 UTC 日向 dsh-market.com 发送一次匿名安装心跳：仅含一个 localStorage 随机 ID 与本包名，无其他数据。服务端只存储该 ID 的加盐哈希，不存 IP，且只暴露聚合计数。完整契约见 [docs/telemetry.md](../../docs/telemetry.md)。
