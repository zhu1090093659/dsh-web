# Agent Note: 皮肤玻璃不得成为插件固定面板宿主的包含块

Status: implemented

## Problem

壁纸专属皮肤激活时，dsh-better-sidebar 的底部工作台完全不可用：展开后什么都不绘制，选择器卡片也无法命中。dsh-better-sidebar 会向 document.body 追加一个包装 div，并给它打上裸属性 [data-dsh-better-sidebar]；视口尺寸的面板宿主 [data-dsh-panel-host] 是这个包装节点的**后代**。宿主是整条链上唯一的固定元素（position: fixed、inset: 0、z-index: 25、overflow: clip），其内部所有面板都是 position: absolute。而皮肤的固定玻璃规则把这个包装节点本身刷上了 backdrop-filter——backdrop-filter 非 none 会让元素成为其 position: fixed 后代的包含块。该包装节点是静态零高节点，于是宿主相对一个空盒子解析，实测塌成贴在视口底边的 1600x0；宿主自身的 overflow: clip 再把所有面板从绘制与命中测试中移除。右侧栏同样被这次塌陷波及，只是它仍在绘制自己的内容，所以缺陷最先以「底栏空白」的形态暴露。

## Decision

壁纸专属皮肤不再绘制这两个宿主外壳。`[data-dsh-better-sidebar]` 与 `[data-dsh-panel-host]` 是定位层而不是表面：固定玻璃规则从下一层开始，落在面板 chrome（`[class*="_panel"]`、`[class*="_bottomPanel"]`、`[class*="_pane"]`、`[class*="_paneCard"]` 及其同级）上，这些元素内部没有固定定位后代，因此不受影响。不保留任何绕过规则（既不中和 backdrop-filter，也不覆盖 overflow）：包装节点直接退出全部选择器列表。

同一轮改动把工作台与轨迹视图收敛为单层玻璃：面板根节点与轨迹视图根节点承载磨砂填充加固定 10px 模糊，而所有嵌套包装（底部面板内的 _panelBody / _pane / _paneContent / _paneTab / _tabBar / _tabList / _terminalWrap，以及 [data-conversation-composer-overlay] 内的 _split / _ledger / _table / _plot / 嵌套 _root）一律重置为透明且不带模糊。把填充画在每层包装上会让同一透明色叠加三到四层，读起来比皮肤其它表面深得多。有两个表面不是简单重置、而是重新上材质：任务看板搜索框与轨迹工具栏搜索框在宿主纯色填充之上改用共享 hover 玻璃，终端画布保留深色磨砂填充以保证文字可读。

## Alternatives considered

在插件侧中和 `overflow: clip` 被否决：宿主盒本身仍然塌成零高，面板几何与命中测试依赖宿主占满视口，只藏起一个症状会留下第二个缺陷。

在 dsh-better-sidebar 里修包装节点（给它非静态定位或视口尺寸）被否决，理由是超出范围：dsh-better-sidebar 是安装进 `$DSH_HOME` 的第三方 npm 包，不属于本仓库，皮肤不应依赖一次依赖升级才能正常渲染。

保留包装节点的玻璃、只针对面板宿主属性加排除被否决：包含块来自宿主所处的包装节点，任何其它皮肤规则再次命中该包装节点，塌陷就会复现（后续复制该文件的皮肤作者也会继承这个陷阱）。

在每层嵌套包装上画磨砂填充（改动前的行为）被否决：三到四层透明填充在壁纸上合成约 0.63 不透明度，并成倍放大 backdrop-filter 开销，与该皮肤声明的单层材质正好相反。

## Consequences

本皮肤以及任何在插件 chrome 上绘制玻璃的皮肤都要遵守这条不变量：选择器可以给插件面板上样式，但绝不能作用在「只是固定定位插件内容的祖先」的节点上。危险集合是任何会为固定定位后代创建包含块的属性（backdrop-filter、filter、transform、perspective、这些属性的 will-change、contain: paint/layout），以及会改变其盒子的属性。两个宿主外壳保持不被触碰，因此 dsh-better-sidebar 以及任何使用同一宿主模式的插件所挂载的面板都保住视口几何。

同样引用这两个宿主的其它皮肤（maid-atelier、phoebe-atelier、orca-link）只在它们上面设置 CSS 自定义属性，不会继承这次塌陷，因此无需连带修改。

已记录的覆盖缺口：现有门禁都抓不到这一类缺陷。PR #1601 的评审把它记为后续项，同时记下两个更小的问题——新增的 `[data-dsh-taskboard-view] input` 规则比其注释更宽（它同时会重刷任务表单输入、时间输入与 `type=checkbox`），以及 PR 证据图归入 docs/archive/pr-evidence，即一次性验证记录的归属目录。评审与其测量记录见 [PR #1601 评审记录](../../../../docs/archive/pr-review-1601-wallpaper-exclusive-workbench.md)。

## Testing

PR #1601 的评审（以 2d92b900 合入）从插件构建产物而非描述重新验证了机制：dsh-better-sidebar 0.19.x 通过 `host.setAttribute('data-dsh-better-sidebar', '')` 加 `document.body.appendChild(host)` 创建包装节点，并把面板宿主作为其后代渲染并打上 data-dsh-panel-host。合入后的 patches.css 中不存在任何以这两个宿主属性为主体的选择器（逐选择器扫描），也不含危险集合里的属性。已提交的市场产物按 git blob 比对而非时间戳：market/dist/assets/skins/wallpaper-exclusive 下的 patches.css、skin.json、README.md、README.zh.md 与源文件一致，打包 zip 内是同一份 patches.css 且皮肤版本为 0.2.1，market/dist/styles.js 内联同一份 patches 文本，tryon-assets 携带变换后的副本，market/dist/manifest/skins.json 只发生 0.2.0 到 0.2.1 的变化。合入后的 head 上 docs:check 与 i18n:check 通过。作者的实机证据（宿主层 1600x950 @ y=0、无 data-dsh-panel-host-degraded 标记、选择器卡片可命中、终端面板可打开）附在 PR 中。

相关记录：[wallpaper-exclusive 原生排队卡片 chrome](2026-08-24-wallpaper-exclusive-queue-dock-chrome.md) 与 [壁纸表面侧边栏与详情面板排除保护](2026-08-30-wallpaper-surface-sidebar-exclusion.md) 覆盖壁纸专属皮肤的其它玻璃表面。
