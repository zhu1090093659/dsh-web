# Agent Note: 创意工坊复制命令降级状态准确性

Status: implemented

## 问题

Issue #1091：在 `packages/dsh-market/src/client/MarketCard.tsx` 中，`copyCommand()` 负责复制插件安装命令。当 `navigator.clipboard.writeText()` 不可用或被拒绝时，降级走 `document.execCommand('copy')` 路径。原实现中 fallback 忽略了布尔返回值与抛错，且外部无条件调用 `done()` 将按钮切换为「已复制」，导致在剪贴板写入实际失败时仍误报成功。

## 决策

重构 `copyCommand`，使 `fallback()` 捕获异常并返回 `document.execCommand('copy')` 的实际布尔执行结果。Clipboard API reject 后的降级分支与直接 fallback 分支均仅在 `fallback() === true` 时触发 `done()`。在 `packages/dsh-market/tests/market-card.spec.tsx` 中补充了回归测试，覆盖直接降级失败、直接降级成功以及 reject 后降级失败场景。

## 影响

正常复制路径无行为变更，异常与受限环境下的复制交互反馈准确，不再出现假成功。
