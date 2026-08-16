# AGENTS.md — dsh-desktop-launcher

DSH web GUI 插件 dsh-desktop-launcher：在桌面创建一键启动图标（Windows .lnk /
macOS .command / Linux .desktop），双击启动 dsh web 并打开 Web GUI。包级规则：
只写本包特有约定，不重复根 AGENTS.md 与 packages/AGENTS.md 的全局/包级规则。

## 本包要点

- 双半区：host 半区（src/index.ts + src/routes.ts）提供 loopback 专用
  /api/dsh-desktop-launcher/create，写 ~/.dsh/desktop-launcher/ 与桌面图标；
  browser 半区（src/client/）在「Web UI 插件」组注册设置卡片（创建按钮 +
  enabled / announceToAgent / dshCommand / url / profile 字段）。
- 纯逻辑在 src/core/launcher.ts（脚本渲染、文件名、路径转义），禁止在
  routes.ts 里内联生成逻辑；测试注入 homeDir / platform / run，不碰真实进程。
- 三件套（settings-form.ts / PluginSettingsCard.tsx / settings-card.module.css）
  是 scripts/sync-shared.mjs 生成的同步副本，禁手改；本包样式新增
  launcher-card.module.css。
- 图标创建会写用户桌面与 ~/.dsh，路由仅限 loopback；改动安全语义需同步
  README「安全模型」与测试。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-desktop-launcher typecheck
pnpm --filter @linxin666/dsh-desktop-launcher test
pnpm --filter @linxin666/dsh-desktop-launcher build
```
