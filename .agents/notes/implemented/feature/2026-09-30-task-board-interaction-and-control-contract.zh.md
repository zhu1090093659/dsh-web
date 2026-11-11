# Agent Note: Task board interaction and control contract

Status: implemented

## Problem

看板的临时界面此前没有"返回"这一段。任务详情浮层以及其上的每个弹窗（新建、编辑、
编辑标签、关联子任务、删除确认）都由一个布尔量挂载，并在清空它的同一个 React tick
上消失：界面出现和消失都没有进出配对，Escape 无响应，焦点停在浮层后面的元素上，
Tab 会走到浮层下面的卡片，弹窗也没有声明为模态。对键盘和辅助技术用户来说，覆盖整块
看板的浮层没有可进入、也可退出的路径。

工具栏是同一个问题的小尺度版本。每个控件各自携带 padding 与字号算术，导致返回控件、
项目选择器、搜索框、两个视图开关和新建按钮在同一行上分别落在五个不同高度；两个开关
按下时直接换成另一套按钮样式（描边换成填充），把相邻元素挤动。还有若干控件的标记来自
文本：`‹`、`×`、`+` 与 `⌁` 分别冒充返回、关闭、新增与会话图标。

## Decision

卡片保留多行预览及可见元数据，不采用牺牲可读性的固定单行布局。Markdown 预览为纯文本；详情使用 marked 词法解析与安全 React 节点，禁用原始 HTML 和自动加载远程图片。此展示逻辑不修改任务存储内容。

看板的浏览器半区在 `src/client/board/` 下拥有一套交互与控件契约：

- **`overlay.tsx` 统辖所有临时界面。** `usePresence(open)` 在退场段保持界面挂载并
  写上 `data-state="closing"`，因此进场与退场是 `board.module.css` 里的一对动效
  （遮罩淡入淡出，叠加 8px/98% 的升起与等量回退；进场 160ms、退场 140ms，在
  `prefers-reduced-motion` 下只保留透明度）。`useDialog(onClose, phase)` 拥有键盘
  契约：打开时焦点进入界面、卸载时回到打开它的控件，Tab 在界面内环绕，Escape 只向
  拥有者请求关闭；模块级的浮层栈让只有最上层界面响应——从任务详情里打开的弹窗会
  自行吞掉 Escape，而不是把两层一起关闭。每个界面声明 `aria-modal="true"` 并带
  `tabIndex={-1}`。
- **看板根容器声明几何与动效 token**，每个单行控件都从其中取高度：
  `--dsh-tb-control-h`（30px）、`--dsh-tb-control-radius`、
  `--dsh-tb-control-gap`、`--dsh-tb-icon-size`、`--dsh-tb-hit-size`（44px）、
  `--dsh-tb-motion-enter`、`--dsh-tb-motion-close`、`--dsh-tb-ease`。于是头部工具栏
  共用一条轨道，移动端的 `min-height: 44px` 仍然覆盖固定高度。
- **选中是变体，不是替换。** 视图开关保留描边控件，用 `data-active` 表达按下状态，
  只改变角色颜色。填充按钮使用配对的主操作三件套
  （`button-primary-fill` / `button-primary-hover` / `label-primary-foreground`）；
  危险操作的前景色改取 `label-primary-foreground`，不再用字面量。
- **标记是矢量图标。** `icons.tsx` 在 16 单位 viewBox 上用 `currentColor` 与 1.3 描边
  绘制返回、关闭、新增、会话与定时图标——与侧栏面板图标同一套配方。纯图标控件保留
  无障碍名称，并用伪元素把指针命中区扩展到 44px，而视觉盒子仍是 30px。
- **头部是"身份 + 工具"。** 控件收进一个 `.boardTools` 分组（普通 class，不新增
  `data-dsh-part` 取值），使标题/宿主信息与工具栏读作两组；卡片元信息行改为换行，
  不再在窄列上把更新时间截成不可读的残片。

## Constraints

- 契约只存在于浏览器半区：协议、账本、宿主、cron 与电源行为均不变，也不引入新的
  运行时依赖——图标是手绘路径，不是新的图标包。
- 进出两段都不得改变界面尺寸，因此浮层到达或离开时其后方内容不会重排。
- 无障碍只增不减：纯图标控件保留 `aria-label` 与 `title`，开关保留 `aria-pressed`，
  弹窗保留其无障碍名称。
- 工具栏分组刻意不新增 `data-dsh-part` 枚举值：该枚举由跨仓库的语义属性契约拥有，
  一个结构性包裹容器不足以构成在那里改契约的理由。

## Testing

`tests/board-overlay.spec.tsx` 覆盖焦点进入、焦点回归、Tab 环绕、两个叠放界面下只有
最上层响应 Escape，以及 presence 的退场段（关闭请求后仍挂载且为 `closing`，在伪造
计时器下经过 `OVERLAY_EXIT_MS` 后消失）。`tag-view.spec.tsx` 与
`subtask-view.spec.tsx` 的新增行查找器改为按标签定位，并断言图标的 viewBox；
`task-detail-edit.spec.tsx` 用 `vi.waitFor` 等待退场段结束。

## Alternatives considered

**只用 CSS 过渡配合 `@starting-style`。** 否决：React 在清空挂载布尔量的那一刻就移除
节点，已经离开 DOM 的节点不会运行任何过渡。退场段必须由让节点继续存活的组件拥有，
这正是 presence 所做的事。

**让所有界面常驻、只切换可见性。** 否决：折叠内容会留在文档里，隐藏的可聚焦元素在
没有显式 `inert` 纪律时仍可被 Tab 到；而表单自身"折叠区域不渲染正文"的契约会被为
外观而改。

**引入无头弹窗/浮层依赖。** 因仓库"不新增依赖"规则否决，且整套契约约 150 行，必须与
本看板自己的 presence 模型一致。

**保留文本字形。** 否决：把标点当图标是明确的规范违反，描边粗细无法与宿主一致，且
屏幕阅读器会把 `×` 读成乘号。

**按下开关时直接换 class（描边样式换成填充样式）。** 否决：两套样式的内边距与字号度量
不同，每次按下都会改变控件尺寸并挤动邻居；同一控件上的变体才能保住盒子。

**为皮肤新增 `data-dsh-part="board-tools"` 锚点。** 暂时否决：这是由
`satellites/dsh-skins/contracts/semantic-attrs-v1.md` 拥有的枚举新增，而工具栏包裹容器
目前还不是皮肤需要定位的界面。

## Consequences

- 关闭中的浮层会在退场段内继续留在 DOM 里，因此"界面已消失"的断言要发生在动效之后，
  而不是关闭的那一刻。
- 每个打开的界面安装一个文档级捕获监听器，并按模块级栈排序；该栈是模块实例级的，
  即每页一个看板。
- 表单的可折叠分区仍然直接挂载/卸载其正文、没有过渡。其内容是被有意卸载的（折叠摘要
  取代它，测试也断言字段不存在），所以界面契约止于浮层；用高度过渡会把隐藏字段留在
  DOM 中。
- 共享设置卡外壳（`shared/client/settings/`）未改动。它是六个包共用的一个组件，需要
  独立变更与证据；本看板设置卡自定义样式落到
  `board-settings.module.css` 的 token 上（原验收区块本身已于 [2026-11-11](../simplification/2026-11-11-remove-task-board-goal-run-and-acceptance.zh.md) 移除）。

这些界面的字号尺度、结果槽位与折叠行为由[卡片界面呈现契约](2026-10-20-task-board-card-surface-contract.md)所有。
