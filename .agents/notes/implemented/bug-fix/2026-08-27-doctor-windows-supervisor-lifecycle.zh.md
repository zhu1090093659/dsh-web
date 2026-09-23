# Agent Note: 修复 dsh-doctor 在 Windows 上的 Supervisor 生命周期与计划任务注册

Status: implemented

## Problem

在 Windows 系统上，@linxin666/dsh-doctor 存在两处严重的生命周期与部署缺陷（Issue #1238）：

1. **CLI 直接入口检查失效**：src/cli.ts 原先使用 import.meta.url === new URL(process.argv[1] ?? '', 'file:').href 做直接入口比对。在 Windows 下，process.argv[1] 包含盘符（如 C:\...），通过 
ew URL(..., 'file:') 解析时产生畸形 URL，导致两者永不相等。CLI 命令被作为模块静默加载后直接退出（Exit Code 0，无任何输出与动作）。
2. **service.ts 中 Windows 路径与 schtasks 参数分词错误**：
   - 误从 
ode:path/posix 导入路径处理函数，导致 Windows 绝对路径被错误解析为 POSIX 路径。
   - 在 \runCommand 中对 win32 使用了 { shell: true }，导致带空格的路径（如 DSH Doctor）被 cmd.exe 拆分为独立参数，schtasks /Create 抛出 ERROR: Invalid argument/option - 'Doctor'。
   - schtasks /TR 目标命令路径包含空格时未用内部双引号包裹，导致 Windows 任务计划程序无法解析目标程序。

## Decision

- **跨平台 CLI 入口判断**：在 src/cli.ts 中重构 isDirectCliRun，统一使用 \fileURLToPath(import.meta.url) 与 \resolve(entryArg) 进行物理绝对路径解析，并在 Windows 下做不区分大小写的标准路径比对。
- **平台自适应服务计划与执行**：
  - src/agent/service.ts 根据平台选择 win32 或 posix 路径解析器。
  - 为 schtasks /TR 参数严格添加双引号包裹（"），保证即使在含有空格的 %LOCALAPPDATA% 路径下任务计划也能正确解析目标。
 - \runCommand 移除 shell: true，直接通过 Node.js 原生 spawn 传递精确参数数组给 schtasks.exe，彻底避免 cmd.exe 参数切分错误。
- **单元测试与回归防护**：新增 ests/cli-entry.spec.ts 与增强 ests/agent-service.spec.ts 断言，全面覆盖 Windows 路径格式与 schtasks 参数结构。

## Alternatives considered

- **强行将 DSH Doctor 重命名为 DSH-Doctor**：即便目录不含空格，用户用户名目录（C:\Users\John Doe）仍可能含空格，单纯修改目录名无法从根本上解决引号与参数解析问题，必须在参数传递与 schtasks /TR 规范上严格转义。

## Consequences

Windows 环境下 dsh-doctor service-install / service-uninstall / supervisor 均能正常执行并成功注册系统级登录后自启计划任务，救援模式在 Windows 上能够正常部署与保活。
