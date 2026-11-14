# Agent Note: browser-view 隔离模式 CDP 自愈与 Windows 子进程树清理

Status: implemented

## Problem

Issue #2051 反馈了 `packages/dsh-browser-view` 在 `isolated` 自管 Chromium 模式下的四类稳定性问题：

1. **CDP 写入失败后连接半死不活。** `CdpClient.send()` 在 `socket.send` 回调报错时仅拒绝单次请求，未 fail 所有挂起请求、未将 `closed` 置为 `true`、也未关闭底层 socket，导致 `BrowserViewService` 后续仍将其当作健康连接复用。
2. **工具调用中途断链直接报错。** 已复用会话在执行 `navigate`、`click`、`type`、`press`、`scroll`、`snapshot`、`screenshot` 途中底层连接断开时，没有回收重建会话并当次重放，而是直接把错误抛给用户。
3. **子进程退出感知滞后与 Windows 子进程树残留。** Chromium 子进程退出未联动关闭 `CdpClient`，`running` / `state()` 在重连前仍显示运行中；Windows 上 `terminate()` 只对父 PID 调用 `child.kill()`，留下 GPU/Crashpad 子进程锁住临时 profile 目录。
4. **临时启动抖动与目录锁清理失败。** 隔离启动遇到偶发端口锁或进程闪退时没有单次重试，`removeTempProfile()` 在句柄刚释放时的短暂锁报错上直接放弃删除。

## Decision

1. **`CdpClient` 写入失败立即自毁止损（`src/core/cdp.ts`）。** 当 `ws` 的 `send` 回调返回错误时，调用 `this.failAll('the DevTools socket write failed: ' + error.message)` 并关闭 `this.socket`，确保 `closed` 立即翻转为 `true`，促使 `requireSession()` 触发替换。
2. **子进程退出联动与 Windows 进程树清理（`src/core/chrome.ts`、`src/host/service.ts`）。**
   - 在 `ChromeProcess` 新增 `onExit(listener)`，并在 `openIsolatedSession` 中绑定 `chrome.onExit(() => cdp.close())`。
   - `terminate()` 在 `win32` 下先执行 `killProcessTreeWin32(child.pid)`（受控调用 `taskkill /PID <pid> /T /F`）清理整棵进程树，再回退 `child.kill()`。
   - `removeTempProfile()` 为瞬时 `EBUSY`/`EPERM`/`ENOTEMPTY` 锁增加短退避重试（默认 `retryDelaysMs = [50, 150, 350]`），同时继续严禁使用 `fs.rm({ recursive: true })` 以防误删软连接或 junction 目标。
3. **活跃传输门控、隔离启动单次重试与当次调用重放（`src/host/service.ts`）。**
   - `running` 与 `state()` 均要求 `!this.session.transport.closed`。
   - `isolated` 模式下的 `listTabs()` 若发现会话已关闭，直接回收并广播状态，同时保持不冷启动浏览器。
   - `startSession()` 在 `isolated` 模式下对非缺少二进制的启动失败（`!/No Chrome binary found/i.test(message)`）自动重试一次。
   - 新增 `runWithSession()` 包裹 `tabFor`、`ensureTab`、`navigate`、`click`、`type`、`press`、`scroll`、`snapshot`、`screenshot`，当动作失败且检测到该次会话的 `transport.closed` 变为 `true`（且 service 未 dispose）时，调用 `requireSession()` 重建会话并重放一次操作。

## Alternatives considered

- **每次工具调用前都无条件重连 WebSocket 或重开浏览器。** 否决：每次重启 Chromium 延迟极高且会丢失当前标签页绑定、登录态与实时录屏流。仅在 `transport.closed` 时回收并自愈可兼顾常态性能与故障恢复。
- **后台定时心跳轮询探测 CDP 存活。** 否决：增加无谓心跳流量和异步定时器生命周期复杂度，且依然无法挽救大消息写入瞬间的断链；结合写回调即刻失效、`onExit` 联动和 `runWithSession()` 能在实际断链时零延迟恢复。
- **使用 `fs.rm({ recursive: true })` 强制删除临时目录。** 否决：递归删除会穿透 Windows junction 与符号链接造成目录外误删，违反仓库文件安全规范。

## Consequences

- 隔离浏览器遇到瞬时启动抖动、子进程异常退出或命令写入半死断链时可在单次调用内自动自愈，无需用户或模型重试。
- `isolated` 模式调用 `listTabs()` 会及时清理死会话状态，同时保持不误触发冷启动。
- Windows 下残留的 Chromium 子进程与临时用户数据目录锁定显著减少。

## Testing

- `packages/dsh-browser-view/tests/core/cdp.spec.ts`：覆盖 `CdpClient.send()` 写入回调报错时 fail 所有等待请求、`closed` 立刻置为 `true` 并关闭底层 socket。
- `packages/dsh-browser-view/tests/host/chrome.spec.ts`：覆盖 `removeTempProfile()` 遇到瞬时文件锁时的退避重试与符号链接防护。
- `packages/dsh-browser-view/tests/host/reconnect.spec.ts`：覆盖中途写断链触发会话回收并重放 `navigate`、隔离模式启动瞬时失败单次重试，以及 `listTabs()` 清理死会话且不冷启动。
- `pnpm --filter ./packages/dsh-browser-view test`（20 个文件、266 个测试）与 `pnpm --filter ./packages/dsh-browser-view typecheck` 全部通过。
