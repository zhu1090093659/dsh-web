# AGENTS.md — dsh-plugin-manager

dsh Web GUI 的插件启停管理器：覆盖官方「插件」分区的「全部」清单 tab，在插件列表里直接即时启停。

## 本包要点

- 双半区：host 半区（src/index.ts + src/routes.ts）提供 loopback 专用
  /api/dsh-plugin-manager/*（list / set-enabled）；browser 半区（src/client/）
  注册 `settings.plugins.tab`（id `all`，order 10，priority -1）阴影覆盖官方
  只读清单 tab（同 id 低优先级胜出）；部署侧另在 profile patch 停用官方
  `ui-settings-plugin-inventory` 条目避免 tab 栏重复。
- 启停走 DSH 原生机制：`entry.update({ disabled })` 即时生效（事务性，失败
  回滚）；持久化写 `<dshHome>/cordis.patch.yml` 的 id-targeted `disabled`
  覆盖（dsh web HMR 热重载）；兜底账本 `<dshHome>/plugin-manager.json` 只记
  停用意图，host 启动后重放。
- 保护清单：`include` / 自身 / `cordis:include`|`cordis:group` / hmr /
  timer 不可停用；启用失败不回退重启（会拖垮 boot）。
- 纯逻辑在 src/core/（patch-file / ledger / service），禁止在 routes.ts 内联
  业务逻辑；测试注入 fake loader 与临时目录，不碰真实宿主。
- `ctx.loader` 官方 SDK 未发布类型：用本地结构化 augmentation
  （src/loader-types.ts，先例 webUiSettings）；浏览器 bundle 纯度门照常。
- 不加 agent 工具、不加系统提示词公告（纯用户侧管理面）。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-plugin-manager typecheck
pnpm --filter @linxin666/dsh-plugin-manager test
pnpm --filter @linxin666/dsh-plugin-manager build
```
