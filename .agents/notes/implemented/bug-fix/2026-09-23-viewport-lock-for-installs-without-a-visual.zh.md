# Agent Note: 无激活视觉时的无条件视口锁

Status: implemented

## Problem

未启用任何皮肤、自定义主题或壁纸的安装，滚动根元素上没有视口锁。官方外壳把 `html`、`body`、`#root` 钉为 `height: 100%` 且 `margin: 0`（harness 检出的 `packages/client/web/src/base.css`），compat shim 打上 `[data-dsh-frame]` 的框架就是宿主那个 `height: 100%; overflow: hidden` 的网格，所以普通安装照理无处可滚——但根元素上同样没有任何 `overflow` 声明，只要页面里有东西比视口更高，文档就变成可滚动的。

皮肤中心早已带了这把锁（[viewport scroll lock on workspace select](2026-08-26-viewport-scroll-lock-on-workspace-select.md)），但它的选择器限定在 `html[data-dsh-skin]`、`html[data-dsh-custom-theme]:not([data-dsh-skin])`、`html[data-dsh-wallpaper-active]`，所以在真正报出页面被拉长的配置里，这份样式是惰性的。

在该配置下，有两条路径让文档高过视口。移动端路径上，聚合的响应式层把 `[data-dsh-frame]` 钉成 `height: 100dvh; min-height: 100dvh`，旁边就是 `padding-bottom: env(safe-area-inset-bottom)`；在默认的 content-box 盒模型下，这段内边距落在钉死的高度之外，框架实测为 `100dvh` 加上该内边距，任何带 home indicator 的设备就把它当成文档溢出扛着。而只要存在任何溢出，这种位移就会显形：对话里的展开控件（承载步骤摘要的工具/步骤过程折叠条，以及整轮过程条）在切换时会对自身调用 `focus()`，而文档可滚时被聚焦的元素会把页面滚到它那里——标题栏与侧边栏顶部被挤出视口，页面看起来向下拉长出一条空白带，这正是 issue #1135 的症状，且无需任何视觉即可复现。

## Decision

无条件锁归聚合 compat 层所有；皮肤中心保留按激活视觉限定的一份。

- `packages/dsh-web-all/src/client/index.ts`（`RESPONSIVE_CSS`）声明 `html:has([data-dsh-frame]), html:has([data-dsh-frame]) > body { height: 100%; width: 100%; overflow: hidden; }`。规则经 `:has()` 限定，外壳框架出现前保持惰性；并且刻意不碰应用根元素——根元素自己的锁因裁掉侧边栏底部设置行、覆盖侧边栏插件的列推移（`#root { width: calc(100% - …) }`）而移除（[avoid root container clipping](2026-08-27-skin-center-viewport-lock-desktop-clipping.md)、[release the root width lock](2026-08-27-skin-center-root-width-lock.md)）。
- 同一份样式表的移动端分块给 `[data-dsh-frame]` 加上 `box-sizing: border-box` 与 `max-height: 100dvh`，让已有的安全区内边距落在钉死的 `100dvh` 高度之内，而不是把它撑高。
- 皮肤中心规则维持现状（按激活视觉限定、带 `!important`）：声明值相同，因此激活了视觉的安装在两份样式同时存在时表现一致。

## Alternatives considered

- **把锁继续留给皮肤中心。** 否决：无激活视觉时它是惰性的，而那正是出问题的配置，普通安装无法从那份样式得到修复。
- **改为锁应用根元素（`[id="root"]`）。** 否决：那把锁裁掉了侧边栏底部设置行，并覆盖了侧边栏插件的列推移（`#root { width: calc(100% - …) }`），见 issue #1222 与 #1225。
- **在锁定元素上用 `overflow: clip` 取代 `overflow: hidden`。** 否决：`hidden` 会让被锁的盒子保持可编程滚动，而浏览器正是靠这一点把确实高于视口的被聚焦内容揭示出来；聚合这份也沿用皮肤中心自 0.3.5 起就在用的配方。两者实测差异很窄——故意让框架高过视口时，`hidden` 下 `focus()` 会把 `body` 推移这段溢出量，`clip` 下为 0，而两种取值下文档偏移都保持 0。
- **把聚合这份也提到 `!important`。** 否决：普通安装里没有声明能压过 `html:has([data-dsh-frame])`，让聚合这份保持非 important 可以让两份样式同时生效时只留下单一的 `!important` 归属方。
- **去掉框架上的安全区内边距，而不是修它的盒模型。** 否决：那段内边距正是让输入框避开 home indicator 的余量；用 `border-box` 消除溢出不必交出这段余量。

## Consequences

- 无激活视觉的安装，其文档不再是滚动目标，被聚焦的展开控件无法再推移页面，标题栏、侧边栏顶部与输入框都留在视口内。
- 这把锁移除的是文档这个滚动目标，而不是所有滚动容器：`html` 与 `body` 保持 `hidden` 语义，所以真正高于视口的 body 级盒子仍可被编程滚动，`focus()` 仍可能把它推移这段溢出量。移动端盒模型消除了已知的那一处溢出来源；要碰到剩下的情形，需要一个高于视口的 body 级元素，而现有交付的安装里没有元素会产生它。
- 施加这把锁也能救回已经位移的页面：根元素变为不可滚时，浏览器会把已存在的文档滚动偏移夹回 0，因此 compat 层不需要配套的脚本 `scrollTo(0, 0)`。
- 超出视口的内容改为被裁切而不是可滚动，这也正是激活了视觉的安装当下已有的行为。
- 桌面几何不受影响：桌面路径只多出根元素锁，框架仍是宿主的 `height: 100%`。
- 启用了皮肤、自定义主题或壁纸的安装不受影响；皮肤中心的声明取值相同，并以 `!important` 取胜。

## Testing

- `packages/dsh-web-all/tests/responsive-contract.spec.ts` 断言这把锁的形状与限定范围（`overflow: hidden`、`height: 100%`、`> body` 那一半、不含应用根选择器）以及移动端盒模型（`box-sizing: border-box`、`height` / `min-height` / `max-height: 100dvh`、安全区内边距）；`pnpm --filter @linxin666/dsh-web-all test` 11 项全绿。
- 针对官方框架结构（框架 `height: 100%; overflow: hidden`，配移动端配方，视口 700px，`env()` 强制为一段内边距）的 Chromium 实测：content-box 下框架实测 720px，文档报 720px，对 1300px 处的元素调用 `focus()` 把文档滚了 20px；改用 `box-sizing: border-box; max-height: 100dvh` 后文档高度等于视口，`focus()` 后 `scrollTop` 仍为 0；仅加根元素锁时 720px 的框架被裁切、文档报 700px，且已滚到 20px 的文档在锁生效时被夹回 0。
- 同一实测改用树里的样式表（而非重新抄写）——`git show HEAD:…/src/client/index.ts` 对比工作区文件，内边距强制为 34px——改动前框架实测 734px、文档报 734px，改动后框架与文档均为 700px。
- 真实 scratch `dsh web` 宿主实测（独立 `DSH_HOME`，装入打包的聚合，未启用皮肤、自定义主题或壁纸，Playwright 驱动所装 Chrome）：提供的 `style[data-dsh-compat="responsive"]` 含这把锁与盒模型；在 1280x800 与 390x844 下文档高度等于视口，`html` / `body` 的计算 `overflow` 为 `hidden`，对置于折叠线以下的元素调用 `focus()` 后文档偏移仍为 0，且无 pageerror 与控制台报错；在已加载页面上精确删掉这两组新规则后 `overflow` 回到 `visible`，同一 `focus()` 会把重新出现的 34px 滚出来；强制 34px 底部内边距时，修复后框架在 844px 视口里实测 844px，删掉规则则为 878px。
- `pnpm libs:check` 对重新构建的 `lib/client.js` 与刷新的 `scripts/lib-artifact-fingerprints.json` 通过。
