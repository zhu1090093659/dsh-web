# dsh-remote-web-ui — 仓库规则

本仓库是 DeepSeek Harness 的外部插件包，开发只能基于官方 NPM SDK
（`@deepseek-ai/*` devDependencies，类型从 node_modules 解析，不引用任何
DSH 源码 checkout）。锚定 0.1.2-alpha.2 cohort。

- 所有产品文案遵循 harness 的 i18n 惯例：`zh` 字典为 key 源，`en` 完整对照，
  通过 `ctx.locale.register` 注册。
- 客户端 bundle 的跨包 value import 受纯度门禁约束（平台模块表 + inline-safe
  wire 层之外一律禁止）——跨插件协作走 cordis 服务或 slot。
- 安全语义（一次性配对令牌、按设备撤销、`/remote` 门控通道、配对即完全控制
  凭据、四个物理本地控制面 /api/pair、/api/update、/api/plugin-manager、
  /api/dsh-desktop-launcher、局域网绑定受管块）修改时必须同步更新 README
  双语与本仓库测试。
- 官方界面移动适配层（`src/client/mobile-adapt.ts`）的选择器以 CSS Modules
  语义后缀为键；官方 GUI 升级后必须做一轮真实 GUI 视觉 QA 再合入。
