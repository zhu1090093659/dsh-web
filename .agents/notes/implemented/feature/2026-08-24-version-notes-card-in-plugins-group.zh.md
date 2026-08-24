# Agent Note: Version notes card inside the Web UI plugins group

Status: implemented

## Problem

上游 issue #1074 希望有一个告知用户本次更新内容的面板。首个实现采用了一个独立的一级设置分区（`web-ui-whats-new`，order 100，位于 Web UI 插件分组之前）。这让一个一次性的更新日志占据了独立的顶层导航位：它为大多数用户只看一次的内容撑大了设置导航，还破坏了全家桶导航图标 CSS 的门禁——该门禁假设四个全家桶分区恰好是八个导航单元格中的最后四个。第二次迭代把说明折叠成分组内的子卡片，导航是干净了，但长文档压在设置页文档流里，读起来像表单一行而非发布页。

## Decision

Web UI 插件分组分区末尾是一行紧凑的「版本说明」入口：标题、一行描述、版本胶囊，以及未读新版本时的「新增」胶囊。点击该行在 primitives `Modal`（headless、加宽到 640px）中打开完整发布页——与 dsh-market 和 dsh-plugin-manager 已在使用的同一 token 驱动弹层——chrome 栏标题栏（macOS 风格交通灯圆点）、hero 区（kicker "What's new in vX.Y.Z"、产品标题、日期、摘要）、横向重点卡（方形类别徽标 + 虚线分隔符）、新增/改进/修复子弹清单、底部主按钮+幽灵按钮对，以及「不再自动弹出更新介绍」复选框，在圆角卡片内部滚动。

打开页面即视为已读：seen 版本经 `whats-new.ts` 的 last-seen 键立即持久化，胶囊随之消失，无需再点一次。版本升级后首次挂载时，Modal 自动弹出一次（方案 D）：`shouldAutoPopup()` 同时检查 `hasNewRelease` 和该版本尚未自动展示过（通过 `WHATS_NEW_AUTO_SHOWN_KEY` 跟踪）。自动展示标记立即持久化，后续挂载不再弹出。「不再自动弹出」复选框仅切换抑制偏好，不关闭弹窗；通过 Got it / Escape / 遮罩关闭时始终确认版本（清除胶囊）并持久化抑制偏好，与复选框状态无关。

`web-ui-whats-new` 分区、其 locale 命名空间以及 `WhatsNewSection.tsx`/`whats-new-locales.ts` 全部移除；由于入口渲染在分组分区树内，其文案并入 `web-ui-plugins` locale 命名空间；`@deepseek-ai/dsh-client-ui-primitives` 作为平台 seed 表允许的值导入加入 devDependencies。宿主缺少 localStorage 时不提示新版本而不是崩溃。访问即抛异常的存储（如隐私浏览边界情况）也能优雅处理：组件不显示"新增"胶囊且禁用自动弹窗。版本数据仍来自 `release-notes.ts`。

## Testing

`pnpm --filter @linxin666/dsh-client-ui-web-ui-settings typecheck`、`build`、`test` 全部通过（12 个文件 109 个测试）；`client-apply.spec.tsx` 断言不再注册独立的更新日志分区，`release-notes-card.spec.tsx` 覆盖入口行、打开即记已读流转、发布页渲染、三条关闭路径（确认按钮、Escape、遮罩点击）、首次挂载自动弹窗（及 auto-shown 标记抑制）、「不再自动弹出」复选框（仅切换偏好不关闭弹窗、关闭时始终持久化）、broken-storage 容错，`webui-section.spec.tsx` 覆盖入口在分组内的存在，`whats-new.spec.ts` 覆盖 `shouldAutoPopup`、`readAutoShown`、`setAutoShown`、`readSuppress` 和 `setSuppress` 辅助函数。

## Alternatives considered

- 保留独立一级分区仅做样式调整。否决：仍然为一个读一次的内容消耗导航位，也仍然破坏八单元格图标门禁；用户明确要求减少一个设置入口。
- 保留内联折叠子卡片（第二次迭代）。用户否决：展示感不足——长正文撑长设置页，折叠形态读作设置表单而非发布页。
- 把说明入口注册进 `web-ui.plugin.item` 子插槽。否决：该插槽是外部全家桶插件的扩展点；内置静态子项无需发明 owner 契约，且让入口与持有版本数据的包保持同源。
- 直接复用共享 PluginSettingsCard 组件。否决：它是 sync-shared 生成的同步副本，绑定暂存表单状态（`CardShell`），只读的说明入口并没有表单状态；在本地 CSS 中镜像其外观可保持入口零依赖。
