# Agent Note: 创意工坊与运行时 Bug 修复

状态：已实现 (implemented)

## 问题背景

在全生态排查并核验了 6 个明确 Bug 报告：
1. **#1141（创意工坊宠物安装 404）**：`scripts/market-build` 按子目录名（`whale`、`whale-refined`）导出宠物静态资源，而非 `meta.id`（`whale-girl`、`whale-girl-refined`），导致客户端安装器按 manifest id 拼接 URL 请求 404。
2. **#1145（创意工坊一键安装皮肤未自动激活）**：在创意工坊安装皮肤后文件已存入 `~/.dsh/skins/<id>/`，但未持久化或更新活跃皮肤指针，用户仍停留在上一套皮肤。
3. **#1154（Wallpaper Engine 404 导致皮肤背景与遮挡滑杆失效）**：当 WE 壁纸资源 404 时 `suppressBackgroundMedia` 依然为 true，皮肤中心走空绘制分支并透明化面板，导致全透白底且滑杆失效。
4. **#1155（原生图片请求开关点击未持久化）**：`setNativeImageEnabled` 硬编码了 `llm-deepseek` 命名空间，在其他 provider 或版本号冲突时抛错且未展示明确错误提示。
5. **#1153（Chat recovery 重试按钮多条静默失效路径）**：在宿主自动重试倒计时窗口或异常中断状态下，点击重试按钮进入静默 return 分支，缺少禁用状态和反馈。
6. **#1149（梁神模式 run_code 报错）**：Phase 1 锚定后升级至 PTC 模式时，缺少明确的转换指引，导致模型仍尝试直接调用 `bash` 工具而触发拦截。

## 技术决策

1. 在 `scripts/market-build` 中统一使用 `assets/pets/${meta.id}/` 导出资源，与 `manifest/pets.json` 保持对齐。
2. 在 `packages/dsh-market/src/client/MarketCard.tsx` 中增加安装成功后的自动持久化与 `dsh-skin-applied` 事件派发；在 `boot.ts` 和 `routes-v2.ts` 中增强对缺失皮肤的安全回退。
3. 在 `packages/skins/skin-center/src/client/wallpaper.ts` 中追踪媒体加载失败事件并降级撤销 active 标记，将 `suppressBackgroundMedia` 绑定至 `wallpaper.isDisplaying()`。
4. 在 `packages/dsh-tool-describe-image/src/native-images.ts` 中动态匹配模型 provider 的设置命名空间并支持版本号冲突重试。
5. 在 `packages/dsh-chat-recovery/src/client/TurnActionsView.tsx` 中将 `hostRetryPending` 纳入判定并在重试中禁用按钮，增加日志记录。
6. 在 `packages/dsh-liangshen/presets/liangshen/tool-bootstrap.mjs` 中为进入 `code` 呈现模式注入明确的 PTC 调用指引。该呈现模式本身已退役（见 [LiangShen mode as a minimal persona plus an injected standard tool catalog](../feature/2026-09-11-liangshen-minimal-prompt-tool-catalog.zh.md)），本条决策在现行 preset 中已无对应对象。

## 影响与收益

- 创意工坊所有内置宠物可正常一键安装。
- 安装新皮肤立即生效，悬空或缺失皮肤安全回退至 `blue-fantasy`。
- 失效壁纸自动降级由皮肤插画接管，遮挡滑杆保持可用。
- 原生图片请求开关支持多 provider 模型并防冲突。
- 对话重试按钮状态与宿主重试真实同步。
- 梁神模式准确理解 PTC 运行规范。

## 验证结论

全仓 `pnpm typecheck` (20/20)、`pnpm test`、`pnpm test:scripts` (203/203)、`pnpm market:check`、`pnpm skin-center:check`、`pnpm aggregate:check`、`pnpm gallery:check`、`pnpm docs:check` 全绿。CodeGraph 索引完成同步（15,779 节点）。
