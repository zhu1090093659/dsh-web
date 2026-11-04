# dsh-remote-web-ui — 仓库规则

本仓库是 DeepSeek Harness 的外部插件包，开发只能基于官方 NPM SDK
（`@deepseek-ai/*` devDependencies，类型从 node_modules 解析，不引用任何
DSH 源码 checkout）。锚定 0.2.2-rc.1 cohort。

- 所有产品文案遵循 harness 的 i18n 惯例：`zh` 字典为 key 源，`en` 完整对照，
  通过 `ctx.locale.register` 注册。
- 客户端 bundle 的跨包 value import 受纯度门禁约束（平台模块表 + inline-safe
  wire 层之外一律禁止）——跨插件协作走 cordis 服务或 slot。
- 安全语义（一次性配对令牌、按设备撤销、`/remote` 门控通道、配对即完全控制
  凭据、三个物理本地控制面 /api/pair、/api/update、/api/plugin-manager、
  局域网转发器与回环判定的两层分工）修改时必须同步更新 README 双语与本仓库测试。
- 本包永不改写宿主 webserver 行的绑定：服务保持回环绑定，局域网可达性由运行时
  转发器 `src/lan-forward.ts` 提供——监听本机局域网 IPv4、端口跟随 webserver 实际
  端口，把请求（含 WebSocket upgrade）转发到 `127.0.0.1:同端口`；转发器丢弃客户端
  自带的 Host 与全部转发头，再盖上局域网权威与 `X-Forwarded-For`，因此经转发器的
  请求永不被判为桌面。绑定失败只丢局域网入口、回环不受影响、状态帧报 error。
  旧版受管块只在激活时清理一次（幂等、原子替换、失败明确报错），不得重新引入
  写回路径。
- 两层回环判定是安全边界：`isLoopbackUpstream`（socket + Host 回环、忽略转发头）
  只用于判断「这个 Host 能否被应答」（`isTrustedHost`）；发放凭据、交出桌面载荷与
  控制面的判定继续用 `isLoopbackClient`（无转发头）。这条判定规则与上面两条本身
  改动时同样要求 README 双语与本包测试一起移动。
- 官方界面移动适配层（`src/client/mobile-adapt.ts`）的选择器以 CSS Modules
  语义后缀为键；官方 GUI 升级后必须做一轮真实 GUI 视觉 QA 再合入。
