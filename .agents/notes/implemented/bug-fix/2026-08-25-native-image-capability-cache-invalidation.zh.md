# Agent Note: 原生图片请求开关切换时客户端能力缓存失效

状态：已实现 (implemented)

## 问题背景

在会话中发送消息时，`describe-image` 发送钩子会按会话将模型图像处理能力判定缓存 30 秒（`DEFAULT_CAPABILITY_TTL_MS`）。当用户在设置面板中切换「原生图像请求」开关时，`setNativeImageEnabled` 会翻转宿主目录并调用 `resolver.invalidate(route)`，但浏览器端的 `createImageCapabilityChecker` 闭包缓存缺少失效清理机制。导致用户切换开关后 30 秒内在原会话发图仍沿用旧的缓存判定（开启后仍被改写，或关闭后向纯文本模型发送原始图片导致报错）。

## 技术决策

1. 在 `packages/dsh-tool-describe-image/src/client/capability.ts` 中维护存活检查器注册表（`activeStores`，每项持有该检查器的判定缓存与在途探测），并导出 `invalidateImageCapabilityCaches(sessionId?: string)` 函数与 `checker.invalidate()` 方法。
2. 在 `packages/dsh-tool-describe-image/src/client/NativeImageSection.tsx` 中，切换成功后主动调用 `invalidateImageCapabilityCaches()` 清空客户端缓存。
3. 失效同时移除该会话的在途探测条目，且探测落地时只有仍是该会话当前条目的结果才写回缓存；因此开关切换前发起的探测仍能答复自己的调用方，但不会再回填缓存（issue #1509）。
4. 在 `client-capability.spec.ts` 中补充针对全局与逐会话失效、以及在途探测在失效之后落地的自动化回归测试。

## 影响与收益

切换「原生图像请求」开关后，下一次发图操作会立即向宿主发起最新能力探测，消除了长达 30 秒的旧判定残留窗口。已经处于在途状态的探测也无法再把切换前的判定写回，该竞争不会再重新打开这 30 秒窗口。

## 验证结论

`pnpm --filter @linxin666/dsh-tool-describe-image test`（388 项通过）、全仓 `pnpm typecheck`、`pnpm test` 与 `pnpm test:scripts` 全部绿灯通过。
