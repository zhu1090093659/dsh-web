# Agent Note: 移动端紧凑模型选择器、对话区裁切修复、覆盖层抑制、鲸鱼开关验证回退

Status: implemented

## Problem

`dsh-remote-web-ui` 手机竖屏表面的四个缺陷（390x844 触摸模拟下在真实 GUI 复现）：

1. **助手消息文字被裁切。** 每条消息首行横向被切（字形上半缺失）。实测几何：消息行是可收缩的 flex 列，其 body 按底部对齐量得 38px，装不下 48px 的文本，首行溢出行顶。对注入样式表做逐条二分定位，锁定罪魁是从 dsh-LAN 移植的规则 `[class$="_scrollBody"] [class$="_body"]{gap:6px}`。
2. **模型选择器在手机上不可用。** 选择器菜单以 `right: 0` 锚定到约 170px 宽的触发器上，菜单与 286px 宽的模型列表都飞出屏幕左缘（390px 下 `x = -42`），模型名不可读。
3. **桌面 workbench 盖住手机屏幕。** 官方 workbench（文件/源代码管理）挂载在一个全视口 portal 层（`[class$="_overlayLayer"]`）里，没有 `data-dsh-plugin` 根属性，且打开状态跨页面持久化。在手机上它盖住整个对话区且没有可见的关闭控件——配对设备看到的是"死屏"。
4. **鲸鱼按钮打不开侧栏。** 官方 `LayoutController` 能挂载，但在运行中的 cohort 上其绑定的 store actions 不会附加：`layout.toggleSidebar()` 正常返回却不翻转任何状态，导致鲸鱼、外部点按收合、右滑展开全部失效。

## Decision

1. **不再移植 `_body` gap 规则。** 该压缩只是观感调整，正确性优先。移除后 body 自然包裹内容（实测所有被探测消息的 `clippedTop` 从 +10px 变为 0）。
2. **底部动作板选择器。** `_composerSeat` 上的 identity transform 仍会成为 fixed 子元素的包含块，因此竖屏下先行解除，再把所有 seat 菜单（选择器、模型列表、强度列表、权限预设）钉到视口底部（`left/right: 8px`、`bottom: calc(8px + env(safe-area-inset-bottom))`、`max-height: 70dvh`、可滚动），单元格 44px。
3. **紧凑图标入口替代桌面文字触发器**（用户的设计）：上下文环保留官方语义；工具行里新增两个合成按钮——方块=模型列表、层级条=推理强度列表——转发到官方触发器并直接钻取到对应菜单单元格（为动作板挂载轮询至约 1.2s）。原文字触发器仅在已接线的按钮存在时隐藏（body class 门控），接线失败会退回可用的文字触发器。按钮与 permission 触发器同行内联；trailing 行收起、上下文环右移（44px），命中区互不重叠。
4. **带验证的鲸鱼开关。** `toggleSidebarVerified()` 先读 frame 状态、调用已接线的 face，150ms 后若 frame 未翻转则回退点击官方 rail/logo 开关（该按钮自己持有 store actions）。展开与收合都有效；jsdom 下对惰性 face 与健康 face 各有测试。
5. **workbench 抑制，限定范围。** `body.dsh-remote-portrait [class$="_overlayLayer"] [class$="_workbench"]{display:none !important}` 只隐藏 workbench 面板。第一版抑制了整个层，导致挂载在同一 portal 的设置弹窗失效——GUI QA 轮次中发现并重新限定。

## Alternatives considered

- 把选择器菜单 `left: 0` 重新锚定到触发器：否决——320-360px 屏幕仍会溢出，且保留局促的 40px 行。
- 为 composer 合成一整套第二 UI：否决——官方响应式收缩加两个转发图标按钮即可达到用户的设计，无需复制状态。
- 抑制整个 `_overlayLayer`：QA 中设置弹窗回归后否决（见 Decision 5）。
- 在宿主侧修复 layout face：超出范围——该 face 位于 DSH 宿主 checkout，本仓库不得修改；回退方案让鲸鱼在任何 cohort 下都可用。

## Consequences

- 手机上助手消息完整渲染；composer 从两行文字触发器变为一行图标；模型与强度选择从任意位置一键直达。
- 竖屏下 workbench 按设计不可达（其面向桌面且本无关闭控件）；横屏或桌面打开可恢复。
- 带验证的开关在健康 cohort 上最多增加 150ms 侧栏打开延迟（检查为空操作），在 face 惰性的 cohort 上恢复鲸鱼。
- 运行时证据采集自运行中的本地构建 `0.1.2-alpha.1-cd5ef81`；layout-face 回退让鲸鱼对 cohort 免疫，但宿主侧 controller 接线问题依然值得上游报告。

## Verification

- 包内 `pnpm vitest run`：296 个测试通过，含三个新测试（动作板/抑制/紧凑 CSS 契约、惰性 face 回退、健康 face 不回退）。
- 仓库门禁：`pnpm typecheck`、`pnpm test`（20 个包）、`pnpm docs:check`、`codegraph sync`。
- 真实 GUI QA（390x844、触摸模拟、Chromium、`http://127.0.0.1:3080/`）：消息文字不再裁切（被探测消息 `clippedTop` 均为 0）；模型列表与强度列表以全宽底部动作板打开且 `fits` 几何检查通过；惰性 face 构建上鲸鱼点按可开侧栏；外部点按可收合；设置弹窗仍可打开；workbench 覆盖层保持抑制。
