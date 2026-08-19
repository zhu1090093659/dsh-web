# AGENTS.md — page-annotate

DSH web GUI 插件 page-annotate：右侧面板（dsh-better-sidebar tab）页面批注。
只写本包特有约定，不重复根 AGENTS.md 与 packages/AGENTS.md 的全局/包级规则。

## 本包要点

- 实现：URL 栏 + 沙箱 iframe 浏览；登录、跳转或拒绝 iframe 的页面使用用户主动触发的
  Electron 持久交互窗口。截图后在真实像素上绘制矩形 / 箭头 / 文字 / 数字批注，
  矩形可绑定区域说明，合成 PNG 后经 describe-image attach 注入会话草稿供模型 OCR。
- 浏览与截图引擎（host 半区）：Electron 持久交互 BrowserWindow 使用独立
  `persist:page-annotate` 分区并从当前页面截图；匿名截图优先 Electron offscreen
  BrowserWindow，回退 playwright-core 无头 Chromium；引擎不可用时提供本地图片上传。
- 挂载位置：dsh-better-sidebar 右侧面板 tab（id `page-annotate`，order 95，
  single: true，拦截 http(s) 外链）。依赖 dsh-better-sidebar 与
  dsh-client-ui-conversation 的草稿注入接口，均为结构化镜像访问，不做 value 导入。
- 目录分区：src/core 两侧共享纯逻辑（url 归一化 / 批注模型 / 合成几何 / 媒体
  嗅探），src/screenshot + src/routes.ts + src/attach-routes.ts 为 host 半区，
  src/client 为 browser 半区。禁 emoji、禁 value 导入 @deepseek-ai/*。

## 关键约束

- electron 不声明为依赖（避免安装数百 MB）；动态 import + 结构化类型 +
  electron-module.d.ts shim 仅供 typecheck，勿删。交互窗口只能由用户显式操作显示，
  必须启用 sandbox / contextIsolation / webSecurity、禁用 nodeIntegration，卸载时销毁。
- 截图路由 loopback 围栏（src/loopback.ts 同步副本）；URL 只允许 http(s)。
- 附件注册表（REF_REGISTRY）上限 128 条，LRU 淘汰；data 经 16MB 上限与
  base64 严格校验后再 saveImage。
- 批注坐标一律 0..1 归一化，导出时按 2x 缩放合成，避免画布污染与滚动错位。
- 测试纪律同 packages/AGENTS.md；浏览器半区测试用 jsdom，canvas 上下文为
  null 时绘制路径必须降级为 no-op。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-page-annotate typecheck
pnpm --filter @linxin666/dsh-page-annotate test
pnpm --filter @linxin666/dsh-page-annotate build
```
