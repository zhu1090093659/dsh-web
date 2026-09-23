# Agent Note: 手机远程界面——皮肤装饰吞掉会话点击，以及五处适配缺陷

Status: implemented

## Problem

一台已配对的手机（竖屏 390x844、触摸模拟、orca-link 皮肤）报了两个可见故障，排查后还牵出另外几处：

1. **点侧边栏任何会话都变成新建会话，而不是打开所点会话。** orca-link 皮肤在侧边栏"新建会话"按钮上用 `::before` 画了一圈装饰性"舞台边框"：`height: calc(var(--orca-stage) - 60px)`（390x844 下 227 px）、`top/left/right: -14px`、`position: absolute`、`opacity: 0`。伪元素盒子的命中测试归属其宿主元素，于是整张会话列表都落在那个不可见按钮里。实测：`document.elementFromPoint(149, 220)` 在 y=118 到 y=287 的每一行都返回 `BUTTON.hHd-Xa_newSession`；真实触摸点击会话行会跳到首页（空会话）。
2. **适配层看起来只认一种皮肤。** 未配对手机的配对 CTA `.fencePairButton` 用了 `background: var(--dsw-alias-brand-primary); color: #fff`。`brand-primary` 是强调/前景 token，不是按钮填充色（见 `contracts/primary-action-tokens-v1.md`）；暗色默认主题实测它解析为 `#f9fafb`，于是白字白底、按钮不可见，只有声明了高饱和品牌色的皮肤（orca-link）下才看得见。
3. **适配层看不见会话行。** 工作区把平铺列表行渲染为 `class="YDXeBa_sessionRow YDXeBa_flatSessionRowWithoutStatus"`，选中行为 `… YDXeBa_selected`；所有行选择器都用 `[class$="_sessionRow"]`（结尾匹配），在该视图模式下**一行都匹配不到**——长按操作菜单、拖拽抑制、点会话后自动折叠全部失效。
4. **应用框架的视口规则过度匹配。** `[class$="_frame"]{width:100%;height:100dvh}` 同时命中了官方对话轮次导航条（`eGxaPq_frame`，`position:absolute;width:28px;pointer-events:auto`）、消息缩略图、子代理状态条和 PlanReviewPanel，把它们撑成全宽 100dvh 的命中拦截块。
5. **回车与焦点处理没对准真正的输入框。** 官方输入框是带 `data-composer-input` 的 contenteditable `div`（该 cohort 根本没有 textarea），所以鲸鱼按钮的失焦逻辑与"禁止程序化聚焦"的补丁都匹配不到它（每次切换会话都会弹出手机键盘）；而回车改写只用 `[class$="_input"]` 限定范围——这个类同样出现在设置、插件与 agent 预设的文本框上，于是那些输入框的回车被吞掉、并被塞进一个单行输入框无法保留的换行。
6. **入座后的头部动作被裁切，甚至整体消失。** `[class$="_header"] [class$="_tabs"]{margin-right:-58px}` 假设官方右侧内边距为 78 px；实际安装的 cohort 实测只有 8 px，于是入座的模式标签与后台任务徽标在 390 px 视口上右端到了 x=432。配套的"原位隐藏"规则又是无条件的：单标签会话没有标签行、也就没有入座位置，两个动作会彻底消失。

## Decision

1. **皮肤装饰不参与交互。** `orca-link/patches.css` 给舞台边框的 `::before` 与 `::after` 角标加上 `pointer-events: none`。它是装饰；hover 视觉保留（按钮自身仍拥有悬停区域），但不再劫持点击。
2. **配对 CTA 改用配套的主按钮 token 组**：`background/border: var(--dsw-alias-button-primary-fill)`、`color: var(--dsw-alias-label-primary-foreground)`，hover 用 `var(--dsw-alias-button-primary-hover, …fill)`。任何主题与皮肤下都可读，符合仓库契约。
3. **行与侧边栏选择器匹配类名 token，而不是属性结尾**：`[class*="_sessionRow"]`、`[class*="_projectRow"]`、`[class*="_rowActions"]`、`[class*="_sidebarCol"]`。状态修饰类会追加到 class 列表尾部，结尾匹配会让适配层与 React 渲染的行悄悄脱钩。
4. **应用框架按语义识别**：`APP_FRAME_SELECTOR = '[data-dsh-frame], [class*="_frame"]:has([class*="_centerCol"])'`（优先聚合层盖的兼容标记，独立安装时回退到官方布局列），注入的视口规则与统一的 `appFrame()` 助手都用它。
5. **输入框相关逻辑以官方字段为准**：`composerFieldOf()`/`isComposerField()` 解析**位于输入区之内**的 `[data-composer-input]`、`textarea` 或 `input[class*="_input"]`。回车改写、pointerdown 记录点击时间、鲸鱼失焦、聚焦补丁全部走它；队列行编辑框（类名 `…_editor`）刻意不算输入框字段，它的 `autoFocus` 因此仍然有效。
6. **头部动作：画到标签行上，绝不搬移节点。** 节点留在它 React 拥有的原位（标题簇）；`body.dsh-remote-header-seated`（仅当头部、标签行、动作三者齐备时才由 `seatHeaderActions()` 设置）用注入 CSS 让它脱离文档流，`alignActionsText()` 收敛一个 `translate(dx, dy)`，使其右边缘落在标签行右边缘、文字基线落在标签文字基线上，并把实际绘制宽度作为标签行的 `padding-right` 预留出来。此前 v67 的"搬进标签行"会让 React 之后的 `insertBefore`/`removeChild` 锚点指向一个已不属于记录父节点的节点，而节点里的后台任务徽标是带实时处理函数的 React 按钮，克隆无法保留其交互。

同一层还附带两处加固：侧边栏切换改为**优先驱动官方 logo 行内的折叠按钮**（120 ms 轮询确认，未翻转才回退到已接线的布局面），因为已接线的 `LayoutController` 在安装 cohort 上是惰性的——整个 800 ms 观察窗口内 `data-sidebar-collapsed` 都没动，而旧的"面优先"顺序让每次鲸鱼点击都要等完 150 ms 的校验；此外滑动手势排除多指触摸、`pointercancel` 不再残留 `whaleSuppressClick`、`draggable="false"` 的覆盖会在退出时还原。

## 后续加固：三项推迟的缺陷

1. **每 tick 的布局开销。** 600ms 同步 tick 原本每拍都用 `createRange()` + `getBoundingClientRect()` 测量头部文字盒，也就是在 React 写入之后强制一次布局读取（消息流式输出时最明显）。现在由头部子树的 MutationObserver（childList/characterData/class）标记几何脏位，`alignActionsText()` 不脏就直接返回，两个 observer 都随层一起断开（`revert()` / `unseatHeaderActions()`）。手机模拟、空闲 6 秒窗口、开/关对比实测：归属本层的布局读取从 8 次 `getBoundingClientRect` + 20 次 `Range.getBoundingClientRect` 降到 1 + 0；在动作节点内人为制造一次变更后，测量重新执行、transform 重新收敛，说明门控不会导致状态滞留。
2. **依赖语言的紧凑选择器钻取。** 模型/推理等级按钮原本靠匹配官方单元格文案（`/模型|Model/`、`/推理等级|Reasoning|Effort/i`）钻取；在其它语言下（本仓库还带 ru）面板会打开但钻取永不触发。现在保留文案匹配作为快路径，并新增结构回退：面板里带"标签 + 当前值 + 箭头"的钻取单元格按顺序即"模型在前、推理等级在后"。中文 GUI 实测能钻入模型列表，另有俄语标签的单测覆盖。
3. **惰性的 `LayoutController`（宿主侧）。** 本仓库不能改宿主，所以没有在这里修复：实测与绕行契约记录在[待上报的宿主缺陷记录](../../proposed/bug-fix/2026-09-09-inert-layout-toggle-face.md)中——`ctx.layout.toggleSidebar()` 正常返回，而 `data-sidebar-collapsed` 在整个 800ms 观察窗口内都没变化；同一状态下 logo 行折叠按钮能立刻翻转。

## Verification

- 真实 GUI：竖屏 390x844 触摸模拟、orca-link 激活、重建后的客户端 bundle（`rev=6e720885bfd4`）：入座后的动作 `parent === wSkVaW_titleCluster`（从未被搬移），transform 收敛到 `translate(185.4px, 42px)`，右边缘在 390 px 视口上为 374——与标签行右边缘一致——徽标按钮的命中测试落在它自己的 `SPAN.QsffPG_count`；紧凑模型按钮能打开面板并钻入模型列表；真实触摸点击会话行仍能切换会话、折叠侧边栏，焦点停在 `BODY`。
- 真实 GUI：竖屏 390x844 触摸模拟、orca-link 激活、重建后的客户端 bundle（`rev=7ae1d1a245ef`）。强制显示舞台边框后 `getComputedStyle(newSession, '::before').pointerEvents === 'none'`；探测的每一行会话 `elementFromPoint` 都返回 `SPAN.YDXeBa_title`（修复前是 `BUTTON.hHd-Xa_newSession`）；真实触摸点击非当前会话行会切到该会话并折叠侧边栏；切换后 `document.activeElement` 是 `BODY`（修复前是 contenteditable 输入框）；入座的头部动作右端在 390 px 视口上止于 x=382（修复前 432）。
- 包内测试：`pnpm --filter @linxin666/dsh-remote-web-ui test` 357 个用例通过，其中 6 个新增用例分别覆盖"嵌套 `_frame` 不算应用框架""回车只在输入区改写""带修饰类的行仍被抑制且退出时还原""头部动作脱流绘制且不被搬移""俄语标签下的结构钻取"，另有重写的切换顺序用例。
- 仓库门禁：`pnpm typecheck`、`pnpm test`、`pnpm i18n:check`、`pnpm docs:check`、`pnpm skin-center:check`、`pnpm aggregate:check`。

## Alternatives considered

- **只修插件、不动皮肤装饰。** 否决：装饰才是根因；适配层无法区分"有装饰在吃我的点击"和"用户点的就是按钮"，而插件侧注入覆盖皮肤选择器的 `pointer-events: none` 等于和皮肤所有者对着干。
- **把所有 `[class$="_…"]` 都改成 `[class*="_…"]`。** 否决：短 token（`_row`、`_card`、`_input`、`_menu`、`_title`、`_root`）会过度匹配无关的官方元素。只改了"官方元素确实会带状态修饰类"的 token，以及它们所在的侧边栏列。
- **只用 `[data-dsh-frame]` 限定视口规则。** 否决：该属性由 `dsh-web-all` 兼容层盖章，本插件独立安装时会失效；`:has([class*="_centerCol"])` 这一支让两种情况都能工作。
- **让已接线的布局面做主路径、缩短回退延迟。** 否决：实测该面在安装 cohort 上惰性，面优先既保留延迟也保留双重切换竞态。
- **保留固定 `margin-right: -58px` 只调数值。** 否决：官方内边距随 cohort 变化（声称 78 px，实测 8 px），任何固定值都会在其中一个上出错；测量方案两者都收敛。
- **把惰性的 `LayoutController` 上报上游了事。** 仍然值得做，但那是宿主侧、不在本仓库范围；切换优先路径让手机界面今天就可用。
- **把头部动作克隆进标签行（既非搬移也非 transform）。** 否决：节点里是带 React 处理函数的后台任务徽标，克隆只能画出来、点不动。
- **用计算出的 `left/top` 绝对定位动作节点，而不是 transform。** 否决：那需要在官方头部上钉一个定位包含块，并在每次布局变化时重新解析；而文字基线对齐本来就需要 transform，不引入新的定位上下文。
- **干脆去掉 600ms tick，只靠 observer。** 否决：tick 是兜底（外部 DOM 清理移除注入样式表、头部挂载较晚的 cohort）；有了脏位门控，它现在每拍只做一次查询，不再读布局。

## Consequences

- 手机上点任意会话都会打开该会话（包括 orca-link 的"安静"侧边栏）；配对 CTA 在默认暗色主题与所有已安装皮肤下都可读。
- 适配层从此能扛住工作区的状态修饰类（选中/平铺列表/菜单打开），也不会再改写无关的官方 `_frame` 表面。
- 在安装 cohort 上侧边栏切换即时生效，在没有 logo 行按钮的组合里仍回退到布局面。
- `data-composer-input` 属性成为本层的承重契约；若未来 cohort 改名，输入区内的 `[class*="_input"]` 仍是回退路径。
- 头部动作不再被搬出它 React 拥有的槽位，React 的调和锚点保持有效，后台任务徽标的处理函数也照常工作；它的位置纯粹是视觉的（脱流 + transform），头部子树一变就重新收敛。
- 选择器钻取不再依赖界面语言，但结构回退假设官方面板保持"模型在前、推理等级在后"的顺序；若某 cohort 调换顺序，中英文下仍会走文案匹配。
- 皮肤修复改变了舞台边框的悬停行为：边框只在指针位于"新建会话"按钮本体上时亮起，而不再覆盖整个舞台区域。这是装饰应有的语义。
