# dsh-page-annotate

[English](README.md) | 中文

DSH Web GUI 的右侧页面批注插件：普通页面可在沙箱 iframe 中浏览；登录、跳转或禁止 iframe 的页面可由用户主动打开持久 Electron 交互窗口。插件从同一登录会话抓取当前页面，在截图上绘制矩形 / 箭头 / 文字 / 数字批注，再经 describe-image 附件机制把合成图发给模型做 OCR 识别。

## 特性

- 右侧面板 tab（dsh-better-sidebar，可关闭）：URL 栏 + 沙箱 iframe 浏览；地址回车或「前往」会真实导航，页面表单、登录和普通链接可直接操作。
- 真实交互浏览：用户点击「交互浏览」后打开独立 Electron Chromium 窗口，支持登录、表单、链接和页面跳转；点击「截取交互窗口」会捕获该窗口当前页面和登录态。
- 匿名截图引擎：优先 DSH Desktop 壳内 Electron offscreen BrowserWindow，兜底无头 Playwright Chromium，最后是本地图片上传。
- 批注画布：矩形、箭头、文字、自动编号四种工具，五色与三档线宽，支持撤销与清空；矩形可绑定、编辑区域说明并合成到导出图片。
- 发送给模型：批注图按 2x 合成后以持久图片引用插入会话草稿，模型可对图 OCR。
- 批注坐标全部归一化到 0..1，任意显示尺寸下绘制不依赖画布像素、不污染画布。
- 双语 UI（zh/en），经 ctx.locale.register 注册。

## 使用

1. 打开右侧面板的 page-annotate tab。
2. 普通可嵌入页面可按回车或点「前往」浏览；需要登录、真实跳转或页面拒绝 iframe 时，点「交互浏览」，在独立窗口完成操作。
3. 点「截取交互窗口」捕获当前登录页面；无需登录时也可用「匿名截图」。进入批注 tab 后绘制标记，矩形绘制完成后填写区域说明。
4. 点发送，把批注图推入当前会话草稿。
5. 发出草稿，模型从图片中读取批注。

## 截图引擎

- Electron 持久交互 BrowserWindow（DSH Desktop 壳内使用；独立 `persist:page-annotate` 会话分区）。
- Electron offscreen BrowserWindow（匿名截图；插件 host 半区运行在主进程）。
- 无头 Playwright Chromium（ms-playwright 缓存的 Chromium；可用 DSH_PAGE_ANNOTATE_CHROMIUM 或 PLAYWRIGHT_BROWSERS_PATH 覆盖）。
- 引擎不可用时提供本地图片上传兜底。

## 安全模型

- 截图路由走 loopback 围栏（127/8、::1、Host 头、同源标记），与插件家族一致。
- 只接受 http(s) URL；file:、data:、javascript: 等一律拒绝。
- iframe 沙箱仅为登录态保留 `allow-same-origin`，仍不授予父页面读取跨源 DOM 的能力；批注只处理宿主截图像素。
- 受 `X-Frame-Options` 或 CSP `frame-ancestors` 限制的网站会拒绝内嵌，应改用用户主动打开的交互浏览窗口。
- 交互窗口使用独立持久会话分区保存站点 Cookie/LocalStorage；仅允许 http(s)，禁用 Node 集成并启用 sandbox、contextIsolation 与 webSecurity。窗口只在用户点击后显示，插件卸载时销毁；插件不读取或记录页面凭据。
- 上传图片经 MIME 嗅探、16MB 上限、严格 base64 校验，附件注册表上限 128 条。

## 与 dsh-annotate 的区别

- dsh-annotate 是 Chrome 扩展 + WebSocket 桥；本插件是纯 GUI 侧面板，无需安装扩展。
- 本插件用 GUI 自带的真实 Chromium 引擎截图，对任何页面可用，包括拒绝 iframe 的页面。
- 本插件的批注模型基于截图像素（截图后绘制），规避跨源画布污染与滚动对齐问题。

## 安装

```sh
dsh plugin --profile web add link:/path/to/dsh-web-ui/packages/page-annotate
```

## 开发

```sh
pnpm --filter @linxin666/dsh-page-annotate typecheck
pnpm --filter @linxin666/dsh-page-annotate test
pnpm --filter @linxin666/dsh-page-annotate build
```

## 许可

Apache-2.0
