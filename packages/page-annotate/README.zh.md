# dsh-page-annotate

[English](README.md) | 中文

DSH Web GUI 的右侧页面批注插件：在沙箱 iframe 中浏览页面，用宿主截图引擎抓取真实 Chromium 截图，在截图上绘制矩形 / 箭头 / 文字 / 数字批注，再经 describe-image 附件机制把合成图发给模型做 OCR 识别。

## 特性

- 右侧面板 tab（dsh-better-sidebar，可关闭）：URL 栏 + 沙箱 iframe 浏览。
- 宿主侧截图引擎：优先 DSH Desktop 壳内 Electron offscreen BrowserWindow，兜底无头 Playwright Chromium，最后是本地图片上传。
- 批注画布：矩形、箭头、文字、自动编号四种工具，五色与三档线宽，支持撤销与清空。
- 发送给模型：批注图按 2x 合成后以持久图片引用插入会话草稿，模型可对图 OCR。
- 批注坐标全部归一化到 0..1，任意显示尺寸下绘制不依赖画布像素、不污染画布。
- 双语 UI（zh/en），经 ctx.locale.register 注册。

## 使用

1. 打开右侧面板的 page-annotate tab。
2. 输入 URL（或直接点击 http(s) 外链预载）并点截图。
3. 切到批注 tab，用工具栏工具在截图上绘制标记。
4. 点发送，把批注图推入当前会话草稿。
5. 发出草稿，模型从图片中读取批注。

## 截图引擎

- Electron offscreen BrowserWindow（DSH Desktop 壳内使用；插件 host 半区运行在主进程）。
- 无头 Playwright Chromium（ms-playwright 缓存的 Chromium；可用 DSH_PAGE_ANNOTATE_CHROMIUM 或 PLAYWRIGHT_BROWSERS_PATH 覆盖）。
- 引擎不可用时提供本地图片上传兜底。

## 安全模型

- 截图路由走 loopback 围栏（127/8、::1、Host 头、同源标记），与插件家族一致。
- 只接受 http(s) URL；file:、data:、javascript: 等一律拒绝。
- iframe 沙箱不含 allow-same-origin，批注也不读取页面 DOM，跨源内容不会泄漏进图片。
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
