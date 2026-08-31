# Agent Note: 移动端竖屏折叠后对话列宽度为 0（皮肤空白）

Status: implemented

## Problem

在竖屏手机上，所有 token 重映射皮肤（鲸吟、蓝色幻想以及默认样式）都渲染出**完全空白的对话界面**——整个应用框架只显示背景画和一枚悬浮鲸鱼按钮，没有侧边栏、没有聊天滚动区、没有输入框。而且这个空白是间歇性的：同一个 URL 有时能展开对话、有时却塌掉，看起来像鲸吟皮肤"随机"重置成了空屏。

缺陷出在宿主外壳的三列框架，不在任何皮肤。`AppFrame` 渲染 `grid-template-columns: {sidebar}px minmax(0,1fr) {details}px`。在窄视口下宿主自动把侧边栏收成**固定的绝对定位悬浮栏**：宿主规则 `[data-dsh-frame] [data-pane="sidebar"] { position: absolute; z-index: 1100 }` 把侧边栏移出了网格流。随后 `dsh-remote-web-ui` 的移动适配层把框架钉成 `grid-template-columns: 0 minmax(0,1fr) 0 !important`（mobile-adapt.ts:96）好让对话区占满整宽——**但它从未给列指定位置**（`grid-column`）。由于侧边栏是绝对定位（脱离流）、`detailsCol` 又是 `display:none`，唯一留在流内的子元素就是 `centerCol`，它自动落入网格的**第一（0px）轨**→ `centerCol` 宽度 0 → 空白。当侧边栏碰巧仍是 `position:relative`（在流内，宿主还没挂载悬浮栏）时，`centerCol` 会自动落入 1fr 轨，界面就能显示。侧边栏 relative↔absolute 的切换正是间歇性的来源；而带背景画的皮肤只是把空白衬托得最显眼。

## Decision

**在折叠竖屏状态下把框架三列钉到显式轨道。** 在 `mobile-adapt.ts` 中，沿用 `[class$="_frame"][data-sidebar-collapsed]` 的 `grid-template-columns: 0 minmax(0,1fr) 0 !important` 覆盖之后，追加：

- `[class$="_sidebarCol"]{grid-column:1/2}`
- `[class$="_centerCol"]{grid-column:2/3}`
- `[class$="_detailsCol"]{grid-column:3/4}`

有了显式定位，无论侧边栏是 `relative`（在流内）还是 `absolute`（脱离流），`centerCol` 都始终占据 1fr 轨。对话界面再也不会塌成零宽；鲸鱼画皮肤至此在每次竖屏加载时都能在背景画之上渲染出真实对话界面。

## Alternatives considered

- **把网格改成单个 `minmax(0,1fr)` 轨道而非 `0 minmax(0,1fr) 0`。** 否决：这会整体去掉三列，使绝对定位的侧边栏和 `overlayLayer` 失去应有轨道；保留三列并显式定位能让每个兄弟单元更稳定，也贴合宿主桌面端几何。
- **强制侧边栏回到 `position:relative`。** 否决：绝对悬浮栏是宿主折叠侧边栏的契约（鲸鱼按钮替代它）；改写侧边栏定位会与宿主冲突，可能破坏悬浮栏/鲸鱼入口的交互。
- **只给 `centerCol` 加 `grid-column:2/3`。** 在完备性上不采用：三列都钉是对称的、零成本，且让列映射意图一目了然，避免未来向框架加入新兄弟时继承到错误的自动定位。

## Consequences

- 竖屏手机上所有皮肤（含鲸吟、蓝色幻想）的对话列都以全宽渲染；所报"随机空白"不再出现。
- 桌面端与宽视口不受影响（修复作用域限定在 `[data-sidebar-collapsed]`）。
- 鲸鱼按钮、手势层及其余移动适配规则行为不变。

## Testing

- `mobile-adapt.spec.ts`：新增断言折叠框架 CSS 含 `_centerCol` 的 `grid-column:2/3`；全部 11 条测试通过。
- `pnpm typecheck`（dsh-remote-web-ui，tsc -b）干净；`tsdown` 构建干净，`lib/client.js` 含新增钉轨。
- 实机（本机 web :3080，390×844 iPhone 仿真上下文）：鲸吟与关闭皮肤两种加载均报告 `centerCol` 宽度 390（原为 0），`[data-conversation-scroll]` 存在，无控制台错误；鲸吟截图显示对话标题、模式行与输入框叠加在背景画之上。
