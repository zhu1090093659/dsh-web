# AGENTS.md — dsh-browser-view

DSH Web GUI 插件 dsh-browser-view（实时浏览器视图）。包级规则：只写本包特有约定，
不重复根 AGENTS.md 与 packages/AGENTS.md 的全局/包级规则。

## 本包要点

- 双半区职责：`src/index.ts` + `src/host/` 掌管 Chrome 进程、CDP 会话、标签页与
  WebSocket 分发；`src/client/` 只画帧与状态，不解析 devtools 协议。
- `src/core/protocol.ts` 是两侧唯一的线上契约（事件、命令、数据结构、版本号与
  校验函数）。改它等于同时改两侧：先改契约，再让两侧对齐，不要各自加字段。
- 席位：`sidebar.right.pane.tab`（keyed/session，标签页内容）、
  `sidebar.right.pane.tab.title`（keyed/session，chip 文字与图标）。两者都经
  `ctx.slots.inject` 声明感知注册。会话头部**不再**有入口：右栏自己的 tab strip
  与 guide 胶囊已经能开这个标签页，头部再加一个只是挤占那一行；不要再加回来。
- 标签页类型经 `ctx.sidebarRightTabs.register` 注册，由右栏按 `kind` 打开；
  `kind` 固定为 `browser-view`。**禁止**改成 `browser`：官方
  `@deepseek-ai/dsh-client-ui-sidebar-browser` 占用该 kind，extension 档位会接管它，
  等于顶掉 shipped UI。
- **禁止**注册 `rightbar` / `rightbar.session`——两者是那一栏本身的单占位，已被官方
  占用。
- 面板是右栏标签页，不是浮层也不是中央页面：不要引入 `position: fixed`、自管显隐或
  `main` / `sidebar.panellist` 注册；`keepMounted` 必须保持开启，切 chip 不能断 socket。
- 面板承载的是**帧**，不是 iframe：被控页面在宿主侧的独立 Chromium 里，浏览器半区
  既无沙箱网络也无同源权限去嵌它。
- 浏览器半区值导入只允许平台种子表成员。两个 `sidebar.right.pane.tab*` 键直接用
  owner 自己的声明，不要本地抄——抄一遍会因 `TabHookContext` 未从 barrel 导出而
  TS2717。

## 安全语义

- 面板 socket 只允许 loopback；非本机请求在升级前即拒绝。
- 默认隔离模式的 Chrome 用系统临时目录下的一次性 `--user-data-dir` 与随机调试端口启动；
  不得把默认模式改为接管用户已登录的浏览器配置目录。
- `realBrowserEnabled` 是默认关闭的显式 opt-in：CDP HTTP 端点与发现返回的 WebSocket 都
  必须重新校验 loopback；连接失败不得回退隔离模式。真实模式不改写真实页面视口，权限
  与关闭规则以 README 的用户契约为准。
- 插件 dispose 时必须停掉投屏：隔离模式杀掉自己启动的 Chromium 子进程；外部 CDP 只
  分离，不关闭浏览器或其标签页。配置切换同样只分离外部会话。修改生命周期要同步 README
  的 `安全模型` 与本节。
- 闲置关闭（`idleCloseDays`，默认 3 天，0 关闭）只关本插件自己创建的标签页：
  `TabManager.idleCandidates` 只认 `origin === 'created'`，接管的真实页面永不因计时被关闭。
  活跃信号只有工具调用（`BrowserViewService.tabFor` 解析成功后 touch），面板观看、投屏帧
  与选中都不算；计时只在内存里，宿主重启后从零开始，不落盘。改这条要同步 README 的关闭
  契约与本包 Agent Note。
- 传输已关闭的会话（外部浏览器重启或崩溃、隔离模式的 Chromium 退出）在下一次调用时按
  同一套清理被替换：外部会话只分离，隔离会话杀掉已退出的子进程后重新拉起；替换失败按
  连接错误上报，绝不切换到另一种模式。
- 截图只经宿主附件服务（`ctx.get('attachments').saveImage`）落盘，因为 image part 的
  `attachment` ref 必须由该服务签发；除此之外不得把截图副本、页面文本或控制台内容
  写进插件自有目录、日志或缓存。附件服务缺席时 `browser_screenshot` 必须报错，不得
  伪造图片或改走临时文件。

- 鉴权补票（`src/host/auth.ts`）：只对 loopback 目标、且文档确实是 DSH 自己的鉴权页
  时才向 `ctx.connection.authenticatedUrl` 取令牌，每次导航最多补一次；无 connection
  服务、取票抛错、补票后仍是鉴权页都必须**静默退化**，不得报错或改变导航结果。令牌
  只经内存流转，不落盘。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-client-ui-browser-view typecheck
pnpm --filter @linxin666/dsh-client-ui-browser-view test
pnpm --filter @linxin666/dsh-client-ui-browser-view build
node scripts/verify-docs.mjs --check
node scripts/i18n-audit.mjs --check
```
