# 智能体笔记：初音未来、Windows XP 与深海女仆工坊皮肤视觉与布局错位修复

Status: implemented

## Problem

### 1. 初音未来皮肤在暗黑模式下立绘丢失
在 `miku/skin.css` 中，`body[data-ds-dark-theme]` 指定了不透明的渐变 `background-image` 与纯深色背景 `#0a1430`，并覆写了不透明的 `--dsw-alias-bg-base` 等变量，遮盖了底层的立绘图层（`assets/miku-art.webp`），导致暗黑模式下立绘完全不可见。

### 2. Windows XP Luna 皮肤缺少组件与整屏死黑
- 宿主壳层的多层实心背景（`[id="root"]`, `[data-pane="conversation"]`, `[class*="frame"]`, `[class*="-l6A3q_root"]`）将经典的 Windows XP Bliss 桌面壁纸完全遮死，暗黑模式下整屏死黑，浅色模式下一片死白。
- 固定定位的 30px XP 标题栏和 24px 状态栏压在宿主顶栏和底栏上，遮挡了 Logo 与底部图标。
- 侧边栏底部容器寻找逻辑与旧 DOM 强绑定，导致绿色的经典「开始」按钮和任务栏背景无法挂载。
- 聊天输入卡片缺少 Luna 边框与窗口阴影。

### 3. 深海女仆工坊角色重叠与首页文字严重错位
- 在 `maid-atelier/hooks.mjs` 中，`isBetterSidebarOpen()` 对全屏宽度容器（1920px > 80px）产生误判，将折叠状态当作展开状态，给 body 强行打上 `data-maid-better-sidebar-open`，导致右侧小女仆向左移位 460px 撞入中心输入框。
- 在 `maid-atelier/patches.css` 中，标语选择器仅匹配 `[class*="headlineText"]`，但宿主新版使用了 `span.CuLr4G_titleGroup` 包裹文字，导致文字落在普通流居左（X=901.5），而鲸鱼徽标居中（X=1095），两者水平错位达 193.5px。

## Decision

### 1. 初音未来立绘图层透出与动态清理
- 将 `miku/skin.css` 中的 `body[data-ds-dark-theme]` 背景图设为 `none`，背景色设为透明。
- 将暗黑模式变量设为半透明，并在 `skin-controller.ts` 的 `setBackgroundLayer` 中增加对 body 行内背景图的清理与还原。

### 2. Windows XP Bliss 经典桌面与防遮挡边距
- 在明亮模式声明经典蓝天绿草地 Bliss 渐变桌面，暗黑模式声明幽深夜景 Bliss 渐变桌面。
- 对宿主壳层、会话面板与滚动画布强制透明（`background: transparent !important;`），确保 Bliss 壁纸完全透出。
- 为 body 设置 `padding: 30px 0 24px 0 !important; box-sizing: border-box !important;`，彻底避开标题栏与状态栏的物理遮挡。
- 为聊天输入卡片添加经典的 XP Luna 对话框底色与立体边框。
- 升级 `findSidebarFoot` 寻找逻辑，稳健挂载绿色「开始」按钮。

### 3. 深海女仆工坊角色归位与标语中轴对齐
- 升级 `isBetterSidebarOpen()`，过滤全屏容器并判定未带 `Hidden` 类名的抽屉展开状态，右侧小女仆稳定居于屏幕右侧边界（X=1920）。
- 升级标题与徽标的 CSS Grid 规则，对 `:is([class*="headlineText"], [class*="titleGroup"])` 统一设置 `grid-area: 2 / 1 / auto / -1; justify-self: center;`，使标题与鲸鱼徽标实现 0 像素误差的完美共轴重合。

## Testing

- 单元测试：`xp-hooks.spec.ts` 与 `maid-atelier-hooks.spec.ts` 全部通过。
- 仓库测试：`pnpm test`（36 套测试、619 个 skin-center 测试全部通过）。
- 全量门禁：`pnpm typecheck`、`pnpm skin-center:check`、`pnpm market:check`、`pnpm docs:check`、`pnpm i18n:check`、`pnpm aggregate:check` 100% 通过。
- 实机无头浏览器 Playwright 验证：在深色与浅色模式下分别对三款皮肤进行原生真实截图与几何坐标计算，验证视觉还原度达到像素级精准。
