# Agent Note: Windows 更新编码容错与调度器 ENOSPC 防护

Status: implemented

## Problem

在桌面与服务器生产环境中存在两项影响系统稳定性的独立缺陷：

1. **Issue #1430**：在未安装 `pnpm` 的 Windows 中文环境，`@linxin666/dsh-remote-web-ui` 的更新流程误报“pnpm 退出码 1”，且错误输出框内全是 U+FFFD 乱码。因为 `WIN_CMD_MISSING_RE` 仅匹配英文 `'not recognized as an internal or external command'`，而中文 cmd 输出的是 `'不是内部或外部命令'`；且子进程输出强制按 UTF-8 硬解导致 CP936/GBK 字节流被破坏为乱码；失败信息也一律硬编码归咎为 `pnpm`。
2. **Issue #1427**：当磁盘空间耗尽（`ENOSPC`）时，`@linxin666/dsh-client-ui-task-board` 调度器心跳写入 `scheduler-v2.json` 失败。其 catch 分支中的 `console.error` 尝试向重定向的 stderr 日志文件（`SyncWriteStream`）写入，同样触发 `ENOSPC`。由于 `process.stderr` 缺少 `'error'` 监听器，Node.js 抛出未捕获错误事件（`throw er; // Unhandled 'error' event`），导致整个 DSH 宿主进程崩溃退出。

## Decision

1. 在 `packages/dsh-remote-web-ui/src/update.ts` 中：
   - 增加容错解码函数 `decodeProcessChunk`，优先按 UTF-8 严格解码，遇无效字节序列自动回退至 GBK（`new TextDecoder('gbk')`），彻底解决 Windows 中文控制台乱码；
   - 扩展 `WIN_CMD_MISSING_RE` 正则以同时支持中英文命令缺失提示，并支持 Windows 下退出码 9009 的缺失判定；
   - 错误提示信息归因到具体失败的候选命令，不再写死 `pnpm`。
2. 在 `packages/dsh-task-board/src/host-service.ts` 中：
   - 增加 `installStreamErrorGuards()`，为 `process.stderr` 和 `process.stdout` 挂载容错监听，防止未捕获流错误带崩宿主；
   - 封装 `safeConsoleError()`，在 try/catch 中防御性输出错误日志，避免流写入异常二次扩散；
   - 在 `scheduleTick`、`schedulePoll`、`scheduleLaunch` 等异步异常处理中全面采用 `safeConsoleError`。
3. 在 `packages/dsh-task-board/src/host-ledger.ts` 中：
   - 启动时自动扫描并清理遗留的 `*.tmp-*` 孤儿临时文件；
   - 在 `setScheduler` 中捕获心跳 sidecar 的 `ENOSPC` 写入异常并优雅降级，保持内存时间戳更新，防止调度中断。

## Alternatives considered

- 在 `update.ts` 中执行子进程前先调用 `chcp 65001`：已否决。`shell: true` 下需要拼接多段复合命令，增加了转义和跨环境不兼容的风险。
- 在 `task-board` 中仅用 `try/catch` 包裹 `console.error`：已否决。在重定向输出场景下，Node.js 的 `SyncWriteStream` 可能同步或异步发出未监听的 `'error'` 事件，直接挂载流错误保护才能从根本上保障宿主进程存活。

## Consequences

- Windows 下更新候选命令缺失能够正确降级至 `corepack` 与 `npx`，错误信息显示清晰可读的本地化中文，不再出现乱码。
- 磁盘满或存储受限时，任务看板调度器心跳异常不会引发级联崩溃，DSH 宿主进程保持稳定运行。

## Testing

- `packages/dsh-remote-web-ui/tests/update.spec.ts` 单测验证了 GBK 解码、中文 cmd 命令缺失降级与退出码 9009 识别。
- `packages/dsh-task-board/tests/host-ledger.spec.ts` 与 `host-service.spec.ts` 单测验证了启动 tmp 清理、ENOSPC 心跳优雅降级与流错误防护。
