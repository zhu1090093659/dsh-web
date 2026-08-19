# AGENTS.md — dsh-plugin-manager

DSH web GUI plugin dsh-plugin-manager. 包级规则：只写本包特有约定，不重复根 AGENTS.md 与
packages/AGENTS.md 的全局/包级规则。

## 本包要点

- 本包在官方「插件」设置分区注册 `settings.plugins.tab` 槽位 Tab（id `family-plugins`，
  order 20，与官方安装器 Tab 并列），提供用户插件列表 / 启停开关 / npm·git 安装 /
  更新·卸载 / 安装冲突对账 / 失败修复会话。
- **双通道纪律**：运行时探测官方 `/plugin-installer` 通道，存在（DSHCode / 1.0.4
  checkout web）则全部走官方 RPC（单一写入器 = 官方安装器）；不存在（npm 发布的官方
  web）则走本包 host 半区的 loopback HTTP 网关——安装/卸载 spawn 官方 `dsh plugin`
  CLI（仍是唯一写入器），启停写 profile patch 的 `disabled` 覆盖行。
- 网关安全：所有 `/api/plugin-manager/*` 路由必须经 `isLoopbackRequest` 门禁；
  set-enabled 写文件走备份 + tmp + rename；不改其它写入器的行（insert 格式行内层
  `disabled` 除外，见 `src/host/rows.ts`）。
- 目录分区：`src/index.ts` host 半区（网关挂载）；`src/host/` 网关实现（profile
  解析、行编辑、CLI 作业、路由）；`src/client/` browser 半区（Tab UI、槽位注册、
  双通道封装）；`src/core/` 两侧共享纯逻辑（wire 解析、冲突 diff、层 diff、修复 seed）。
- wire 形状镜像官方 `ui-settings-plugin-installer` 的协议（DSH 源码 checkout），是
  契约观察而非 import；形状变化时更新 `src/core/protocol.ts` 与测试。
- 修复会话纪律：seed 文本只含安装目标、失败记录与路径，禁止追加任何密钥 / token /
  环境内容（见 `src/core/repair.ts` 头注释）。
- 共享件副本：`src/mount-once.ts`、`src/host/loopback.ts`、`src/host/dsh-home.ts`
  由 `scripts/sync-shared.mjs` 生成，禁止手改。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-client-ui-plugin-manager typecheck
pnpm --filter @linxin666/dsh-client-ui-plugin-manager test
pnpm --filter @linxin666/dsh-client-ui-plugin-manager build
```
