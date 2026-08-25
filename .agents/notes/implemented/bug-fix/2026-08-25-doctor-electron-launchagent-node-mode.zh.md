# Agent Note: Doctor Electron LaunchAgent Node 模式

Status: implemented

## Problem

在 macOS 上，DSH Desktop 通过 Electron utility process 托管 Harness。因此 Doctor 看到的 `process.execPath` 是 Electron Helper，而运行中的 Harness 依赖 `ELECTRON_RUN_AS_NODE=1` 让子进程按 Node 语义执行。Doctor 把 Helper 路径写入 `com.dsh.doctor.plist` 时只保留了 `DSH_DOCTOR_HOME`；launchd 随后在没有 Node 模式的情况下启动 Helper。Helper 进入 Electron 启动流程并以 `EXC_BREAKPOINT` / `SIGTRAP` 崩溃，`KeepAlive` 约每十秒重复一次失败，反复启动可能抢占用户当前应用的焦点。

## Decision

macOS 服务适配器在安装 Doctor CLI 继承到 `ELECTRON_RUN_AS_NODE=1` 时，将该变量保留到 LaunchAgent。普通 Node 宿主安装不会加入该变量。现有幂等服务部署会替换受影响的 plist 并重启 Supervisor，因此 Doctor reconcile 时会应用修复后的定义。

## Alternatives considered

- **根据可执行文件名或 bundle 路径判断 Electron**：Helper 名称和应用路径在开发版、打包版及改名版本之间不同。保留明确的运行时标志比路径启发式判断更可靠。
- **在 macOS 上始终设置 `ELECTRON_RUN_AS_NODE=1`**：在当前环境中对真实 Node 可执行文件无害，但会在不需要的位置引入 Electron 专属契约。条件传播可以保持普通 Node 服务不变。
- **让 DSH Desktop 重写第三方 LaunchAgent**：服务定义属于 Doctor。在归属方修复可以避免 Desktop 硬编码某个插件，同时覆盖其他基于 Electron 托管 Harness 的发行版。

## Consequences

从 Electron 托管的 Harness 安装的 Doctor Supervisor 会作为 Node 程序启动，不再进入 Electron 启动流程。已有受影响安装会在 Doctor 的正常 ensure 流程重新部署服务时得到修复。若用户在收到修复前已经删除插件，包代码已不存在，无法执行 reconcile，仍需手动注销遗留 LaunchAgent。

## Testing

服务适配器测试覆盖 Electron Node 模式存在时的传播，以及普通 Node 安装时不写入该变量。包级 typecheck、test 和 build 门禁验证发布源码与 CLI bundle。
