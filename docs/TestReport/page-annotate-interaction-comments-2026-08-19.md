# 测试报告：page-annotate 真实网页交互与区域说明

- 日期：2026-08-19
- 包：@linxin666/dsh-page-annotate
- worktree：.worktrees/dsh-page-annotate
- 分支：feat/page-annotate

## 缺陷描述

浏览模式的地址栏回车实际触发匿名截图，sandbox iframe 不保留站点同源身份，且目标 Frappe 页面受 X-Frame-Options 或 CSP frame-ancestors 限制，无法形成可交互子 frame。矩形批注对象只有几何和样式，没有与圈选区域绑定的说明字段或编辑入口。

## 根因与修复

- 地址栏 Enter 改为导航，增加「前往」动作；远程 iframe 保留 allow-same-origin，同源 DSH 地址自动移除该权限。
- 增加由用户明确点击才显示的 Electron 持久交互窗口，使用独立 persist:page-annotate 分区保留 Cookie 和 LocalStorage，支持登录、表单和跳转。
- 增加 browser/open 与 browser/capture loopback 路由；后者从同一交互窗口的当前 webContents 截图并返回当前 URL。
- Annotation 增加 comment 字段，store 增加可撤销 update；绘制矩形后立即出现说明输入，批注列表可再次编辑，导出画布绘制说明标签。

## TDD 用例

| 用例 | 关键断言 | 结果 |
| --- | --- | --- |
| 地址栏回车导航 | iframe src 更新；sandbox 含 allow-same-origin；不请求截图路由 | 通过 |
| DSH 同源 iframe 安全策略 | 同源 URL 不授予 allow-same-origin | 通过 |
| 显式打开交互窗口 | 仅点击按钮后 POST browser/open | 通过 |
| 交互浏览器路由 | URL 校验、loopback 围栏、当前页截图和 URL 返回 | 通过 |
| 持久窗口生命周期 | 复用单窗口、persist 分区、关闭清理、打开前禁止截图 | 通过 |
| 矩形区域说明 | comment 绑定矩形、update 可撤销 | 通过 |

红灯证据包括 makeInteractiveBrowserRoutes 未实现、store.update 不存在、Enter 后没有 iframe；实现后全部转绿。

## 自动化执行结果

    pnpm --filter @linxin666/dsh-page-annotate test
    Test Files  14 passed (14)
    Tests       63 passed (63)

    pnpm --filter @linxin666/dsh-page-annotate typecheck
    exit 0

    pnpm --filter @linxin666/dsh-page-annotate build
    host 与 client bundle 构建成功

    pnpm docs:check
    verify-docs: all documentation gates passed

全仓 pnpm typecheck 通过。全仓 pnpm test 在无关的 dsh-ssh 失败：已安装的 @deepseek-ai/dsh-tools 无法解析 @deepseek-ai/dsh-scope；page-annotate 自身 63 个用例全绿。pnpm test:scripts 另有 2 个与本包无关的既有失败：社区插件索引生成文件不一致、gallery dry-run 缺少 index.html。本包测试、类型、构建和文档门禁均通过。

## Playwright 运行态验证

验证地址：http://127.0.0.1:63274

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| 普通网页真实导航 | iframe 加载 https://example.com/，子 frame 标题为 Example Domain，Enter 产生 0 次截图请求 | .Codex/qa-evidence/page-annotate-interaction/01-browse-navigation.png |
| 目标 Frappe iframe | 目标 URL 未形成子 frame，确认不能把 iframe 改动当作目标页修复 | Playwright 控制台记录 frameUrl=missing |
| 区域说明闭环 | canvas 拖出矩形后出现说明输入；区域 1 列表保存“登录区域需要补充校验提示” | .Codex/qa-evidence/page-annotate-interaction/03-region-comment.png |

新增 Electron host 路由需要 DSH Desktop 主进程重载插件后才能在现有 GUI 生效；当前会话未主动重启 DSH，避免中断用户工作。host 路由和窗口生命周期已由定向单元测试覆盖，完整运行态登录/跳转/同会话截图需在重载后补验。

## 安全验证

- 交互窗口只接受 http(s) URL，路由仅允许 loopback 请求。
- BrowserWindow 启用 sandbox、contextIsolation、webSecurity，禁用 nodeIntegration。
- 登录态位于独立 persist:page-annotate 分区；插件不读取或记录页面凭据。
- 窗口只在用户点击后显示，插件卸载时销毁，避免后台自动弹窗抢焦点。

## 验证结论

普通网页导航与圈选区域说明已通过真实 Playwright 验收。目标 Frappe 页面拒绝 iframe 的根因已复现，可靠修复已落在用户主动触发的持久 Electron 交互窗口及同会话截图链路。包级回归全部通过；待 DSH 主进程重载后补充目标页的交互窗口运行态证据。
