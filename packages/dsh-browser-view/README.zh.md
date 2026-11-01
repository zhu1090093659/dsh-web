# dsh-browser-view · DSH Web GUI 的实时浏览器视图

[English](README.md) | 中文

<p align="center">
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.1--rc.3-4c6ef5?style=flat-square&amp;labelColor=454a54" alt="DSH">
  &nbsp;
  <img src="https://img.shields.io/badge/license-BSD--3--Clause-blue?style=flat-square" alt="License">
</p>

> agent 驱动的那个浏览器，从对话旁边的标签页里看着。宿主半区掌管 devtools 连接：默认连它自己拉起的独立 Chromium，也可以连你开了远程调试的那个浏览器；浏览器半区贡献一个右侧栏标签页类型，于是页面在验证的当下就在眼前。

本包是 DeepSeek Harness（DSH）的外部插件，形态是 cordis bundle：`src/index.ts` 是宿主半区（Chrome 进程、CDP 会话、标签页登记、WebSocket 分发、agent 工具），`src/client/` 是浏览器半区（右栏标签页内容与它的 chip）。

## 它能做什么

- **实时标签页，不是定时截图**：CDP `Page.startScreencast` 的帧经一条 WebSocket 送来，来一帧画一帧。标签页显示当前页面、URL 与标题，以及 agent 最近做了什么。
- **十一个 agent 工具**：`browser_navigate`、`browser_click`、`browser_type`、`browser_press`、`browser_scroll`、`browser_snapshot`、`browser_screenshot`、`browser_console`、`browser_network`、`browser_tabs`、`browser_close`。
- **证据留在对话里**：每次 `browser_screenshot` 的结果都带图，于是对话记录保留的是 agent 真正看到的那一屏，而不只是一句转述。
- **默认隔离**：插件自己拉起 Chromium，用一次性 profile；只要下面那个模式关着，它就不碰你已经登录的浏览器。
- **按需接管你自己的浏览器**：把 `realBrowserEnabled` 打开后，插件经 CDP 接管你用远程调试启动的浏览器。本机每个 DSH 会话都能枚举、读取、导航、点击与输入它现有的全部标签页，以及之后新开的标签页；那个 profile 里已有的登录态直接可用，因为页面就跑在里面，插件不导入任何 cookie。
- **能进这台机器自己的 GUI**：全新隔离 profile 没有会话 cookie，本来只会看到 401 提示页。当导航落在 loopback 上的那页提示时，插件向宿主的连接服务要一条与 `dsh web` 启动时打印的同样的带票 URL，补一次。种下的 cookie 只活在这个一次性 profile 里，随它一起销毁。
- **关闭是显式的**：不带 tab id 的 `browser_close` 只关调用它的会话自己打开的标签页；被接管浏览器的标签页，只有调用里点名它的 id 才会关。面板对这种标签页不提供关闭控件。

## 工作原理

```text
agent 工具调用 ──► 宿主半区 ──► CDP ──► 它自己的 Chromium，或你的 CDP 浏览器
                       │
                       └─ 投屏帧 ──► WebSocket ──► 右栏标签页内容
```

默认的隔离模式下，宿主半区在第一次工具调用时才懒启动 Chrome，钉住视口尺寸，并按标签页保留控制台与网络请求的环形记录，因此一次验证不必重跑页面就能回读。接管模式下，列出标签页或挂载面板会对着配置的端点开同样形态的会话，自己不启动任何进程。顶层文档被替换时两份记录都会清空；同文档导航（hash、query、SPA pushState）则保留。

## 截图保真

`browser_screenshot` 默认截无损 PNG：截图往往要被再看一遍，标注、细边框与小字号标签保持清晰，不会糊成 JPEG 的振铃。体积比像素更重要时用 `format` 切到 `jpeg`。

- **截一块，而不是整页**：`clip` 收 `{ x, y, width, height }`（CSS 像素），与 `browser_snapshot` 的 box、`browser_click` 的 `x`/`y` 是同一坐标系。带 clip 时默认按 2 倍渲染，`scale` 可以改。
- **`scale` 只取 1、2、3**：显式给出的值总是优先于 clip 的默认值。
- **为什么要这些额外像素**：模型侧一个视觉 token 格大致覆盖 42x42 像素，整屏截图本来就偏粗。要看细节，先从 `browser_snapshot` 取 box，再只截那一块；2 倍下同一个元素占用的 token 是整屏里的数倍。
- **越界会明确报错**：`clip` 落到被钉住的视口（隔离模式，1280x800）或标签页真实视口（接管模式）之外，或编码后超出宿主的附件体积预算，都会作为错误报出原因。没有渲染出来的区域不会返回图片。

## 界面席位

| 席位 | 类型 | 放什么 |
| --- | --- | --- |
| `sidebar.right.pane.tab` | keyed，session | 标签页内容 |
| `sidebar.right.pane.tab.title` | keyed，session | chip 的文字与图标 |

会话头部不再为该标签页提供入口：右栏自己的 tab strip 与 guide 胶囊已经能打开它，再加第三个入口只是挤占那一行。

标签页类型经 `ctx.sidebarRightTabs.register` 注册，用 `ctx.sidebarRight.openTabIn` 打开。它的 kind 是 `browser-view`，**刻意不是** `browser`：官方 `@deepseek-ai/dsh-client-ui-sidebar-browser` 占用了那个 kind，而 extension 档位会接管同名 kind，复用等于把官方那个标签页顶掉。

单占位的 `rightbar` / `rightbar.session` 仍然不碰：它们属于那一栏本身，不属于栏里的标签页。

## 配置

两个字段都是 volatile，因此设置表单由宿主按它们生成，改动无需重启即作用于运行中的插件。它们同时以「真实浏览器」卡片出现在「Web 扩展 → Web 插件」中，与插件行配置页编辑的是同一份取值。

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `realBrowserEnabled` | `false` | 接管用远程调试启动的浏览器，而不是拉起独立 Chromium |
| `cdpEndpoint` | `http://127.0.0.1:9222` | 要接管的浏览器的 HTTP 端点；主机不是 loopback 时直接拒绝 |

打开接管、关掉接管、改端点，三者都只是从插件当前连着的浏览器上分离。外部浏览器与它的每个标签页都保持原样；下一次工具调用按当前设置重新连接。插件自己拉起的浏览器仍然按原有行为关停。

面板会标出当前模式，接管模式下还标出所连的端点。面板依旧只是视图：输入来自 agent。

浏览器要你自己先启动，端点那侧才有东西应答。

```bat
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\chrome-cdp-profile"
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222 --user-data-dir="C:\edge-cdp-profile"
```

在那个 profile 里登录一次 agent 需要看的站点；插件驱动的是那些页面，不导入它们的 cookie。`--user-data-dir` 是必需项而不是可选项，原因见[已知限制](#已知限制)。

## 安全模型

- **两种模式都只走 loopback**：面板 socket 以 loopback 围栏，非本机来源在升级之前就被拒绝；CDP 端点的主机不是 loopback 时，在建立连接之前就被拒绝。
- **CDP 端点没有鉴权**：devtools 协议没有凭据，本机上任何能连到那个端口的进程都能驱动同一批标签页。模式默认关闭，端点限制在 loopback，是为了把这份触达留在这台机器里。
- **隔离模式用一次性 profile**：Chrome 跑在系统临时目录下全新的 `--user-data-dir` 上，调试端口随机，用户真实浏览器的 cookie、会话与扩展都够不着。
- **登录态留在你自己的浏览器里**：插件读的是页面，不是 cookie 罐；被接管 profile 里的任何东西都不会被复制进插件、隔离 profile 或磁盘。
- **每个 DSH 会话都能看到每个标签页**：接管模式开着的时候，本机每个会话都能枚举、读取、导航、点击与输入被接管浏览器的每个标签页，包括接管之后新开的那些。这份权力是给这台主机的，不是给某一个会话的。
- **默认无头**：隔离模式下桌面上不会弹出窗口，标签页是唯一的可见视图。
- **进程寿命**：插件自己拉起的 Chromium 在插件卸载时被杀掉；插件卸载或配置变更只从外部浏览器分离，不关闭浏览器，也不关闭它的任何标签页。
- **失败是报错，不是降级**：端点没有应答时工具调用以连接错误失败，插件绝不回退到隔离浏览器，因此面板不会显示出所配置之外的那个浏览器。
- **令牌处理**：启动令牌每次导航现取、只在内存里，从不落盘；补票只发生在 loopback 目标且文档确实是 DSH 自己的鉴权页时，因此令牌不会被交给别的本地服务。

## 已知限制

- 标签页只是**视图**。输入来自 agent 的工具调用，不转发你的鼠标与键盘。
- 接管模式列出浏览器现有的每一个标签页，包括与当前工作区毫无关系的那些；面板不过滤也不隐藏它们。
- Chrome 136 及以后对默认数据目录忽略 `--remote-debugging-port`，因此默认 Chrome profile 无法这样接管：要使用显式以非默认 `--user-data-dir` 启动的 profile（[Changes to remote debugging switches](https://developer.chrome.com/blog/remote-debugging-port)）。
- 没有用调试端口启动的浏览器，或已经退出的浏览器，会在工具调用上报连接错误；插件不会替它启动任何东西。
- 标签页住在右侧栏里，因此需要那一栏存在；布局把栏收起来时它也一起不可见。
- 帧在页面变化时才产生，静态页面停留在最后一帧，而不是重复推流。
- 切换 chip 时内容保持挂载（`keepMounted`），socket 不会断；画面仍等下一次变化。
- 补票只覆盖站点根地址，因为 DSH 只在 `GET /` 时以 303 回应鉴权提示。
- 一个宿主一个浏览器；标签页是相互隔离的 CDP target，不是独立 profile。
- 隔离模式需要 Chrome 装在标准位置（或用 `CHROME_PATH` 指定）；它也是唯一会拉起浏览器的模式。
- 默认的隔离模式下视口被钉在 1280x800，因此 `clip` 必须落在视口内；视口外的区域直接报错，而不是滚过去再截。接管模式下边界是该标签页自己的布局视口。

## 安装

```sh
dsh plugin --profile web add link:<this repo>/packages/dsh-browser-view
```

插件行只在启动时读取，因此安装或改动之后需要重启一次 DSH。

## 开发

```sh
pnpm --filter @linxin666/dsh-client-ui-browser-view typecheck
pnpm --filter @linxin666/dsh-client-ui-browser-view test
pnpm --filter @linxin666/dsh-client-ui-browser-view build
```
