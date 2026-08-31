# Agent Note: 桌面启动器快捷方式自动打开浏览器可靠性优化

状态：已实现 (implemented)

## 问题背景

在 Windows 下使用 `dsh-desktop-launcher` 生成快捷方式并启动 DSH 时，快捷方式无法自动打开浏览器：
1. 快捷方式使用 `-WindowStyle Hidden` 启动 PowerShell。在隐藏窗口的 PowerShell 进程中直接调用 `Start-Process $url`（Win32 `ShellExecuteEx`）时，若浏览器此前未启动，会继承父进程的 `SW_HIDE` 属性，导致浏览器在后台静默运行但窗口完全不可见；若浏览器已在运行，后台进程也无法突破 Windows 前台锁定将窗口置顶显示。同时 PowerShell 随后立即 `exit 0` 会打断未完成的 Shell IPC 通信。
2. Windows PowerShell 5.1 的 `Invoke-WebRequest` 在收到非 2xx/3xx 响应（如安全围栏 401/403）时抛出 `WebException`，原代码直接在 catch 块返回 `$false`，导致即使 DSH Web 端口已正常监听并响应，启动器仍判定为未就绪并盲等 60 秒超时，从未执行打开浏览器的逻辑。
3. 若 DSH 启动瞬间异常闪退，启动器未检测后台进程状态，导致用户无谓盲等 60 秒超时。

## 技术决策

1. 在 `packages/dsh-desktop-launcher/src/core/launcher.ts` 中：
   - 为 Windows PowerShell 启动器引入 `Open-DshUrl`：优先使用 `Start-Process -FilePath 'explorer.exe' -ArgumentList $url` 将打开 URL 请求委托给 Windows 顶层桌面 Shell（Explorer.exe），确保默认浏览器以正常可见窗口（`SW_SHOWNORMAL`）在前台启动并展示；异常时回退到 `Start-Process -FilePath $url`。
   - 增强 PowerShell `Test-DshUrl` 异常处理：在 catch 中检查 `$_.Exception.Response.StatusCode`，将 200..499 范围的状态码均识别为服务在线信号。
   - 启动 DSH 时通过 `-PassThru` 捕获后台进程并在轮询循环中检测 `$dshProcess.HasExited`，进程异常退出时立即弹窗提示退出码，避免无效等待。
   - 在 POSIX 启动器（macOS/Linux）中补充进程存活检测（`kill -0 "$DASH_PID"`）。
2. 更新 `packages/dsh-desktop-launcher/tests/launcher.spec.ts` 中的断言。

## 影响与收益

- Windows 桌面快捷方式启动 DSH 并在服务就绪后，能稳定可靠地在前台正常打开默认浏览器。
- 启动探测可兼容 4xx 等 HTTP 响应状态。
- DSH 启动闪退时可立即获得明确错误提示，提升排障与使用体验。

## 验证结论

- `pnpm --filter @linxin666/dsh-desktop-launcher test`（54 个用例全部通过）
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:scripts`
- `pnpm docs:check`
