# Agent Note: 释放皮肤中心 Shell 渲染校正对根容器宽度的锁死

状态：已实现 (implemented)

## 问题背景

皮肤中心在 0.3.5 版本中为了防止外层页面滚动条位移引入了视口与根容器锁（#1135），但在 `[id="root"]` 上声明了 `width: 100% !important;`。
这导致依赖调整 `#root` 宽度实现分栏推挤的侧边栏插件（如 `dsh-better-sidebar` #1222 中的 `#root { width: calc(100% - var(--dsh-sidebar-width, 0px)) }`）失效：`#root` 被强制保持满宽，打开右侧面板时无法收缩，面板以悬浮层形式遮挡对话消息。

## 技术决策

在 `packages/skins/skin-center/src/client/runtime/shell-rendering.ts` 中：
- 将 `[id="root"]` 的 `width: 100% !important;` 调整为 `max-width: 100% !important;`；
- 保留 `[id="root"]` 的 `height: 100% !important;`、`max-height: 100% !important;`、`overflow: hidden !important;` 以及 `html` / `body` 上的全屏视口锁。

## 影响与收益

- 恢复第三方侧边栏插件（如 `dsh-better-sidebar`）打开面板时对 `#root` 容器的分栏推挤能力，避免悬浮遮挡；
- 继续保持视口与 body 的溢出锁定，防止页面出现外层滚动条或位移。

## 验证结论

在 `packages/skins/skin-center/tests/skin-runtime.spec.ts` 中增加了回归测试断言，`skin-center` 585 项测试及全仓门禁全部通过。
