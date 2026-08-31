# Agent Note: 避免皮肤中心视口锁导致桌面端根容器底部截断

状态：已实现 (implemented)

## 问题背景

在 `packages/skins/skin-center/src/client/runtime/shell-rendering.ts`（#1225）中：
此前在 `[id="root"]` 上声明了 `height: 100% !important;` 与 `overflow: hidden !important;`。
在 DSH Desktop 2.0.3 兼容模式（含原生窗口标题栏的桌面环境）下，这会导致根容器发生微小的溢出裁剪，使左侧侧边栏最底部的「设置」齿轮按钮与用户头像栏被视口底部卡位截断。

## 技术决策

- 保留 `html` 与 `body` 上的视口锁定（`height: 100% !important; width: 100% !important; overflow: hidden !important; margin: 0 !important; padding: 0 !important;`），以彻底杜绝外层页面滚动条位移；
- 从 `shellRenderingCss()` 中彻底移除对 `[id="root"]` 的硬编码尺寸与溢出裁剪锁定，让 `#root` 与侧边栏布局自然适应桌面端窗口高度。

## 影响与收益

- 解决桌面兼容模式下左侧侧边栏底部设置按钮被卡位截断的问题（#1225）；
- 保持对侧边栏插件分栏推挤（#1222）的原生支持；
- 页面外层继续保持无滚动条与防位移状态。

## 验证结论

在 `packages/skins/skin-center/tests/skin-runtime.spec.ts` 中更新了断言，全仓单测与门禁全部通过。
