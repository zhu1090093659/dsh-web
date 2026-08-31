# Agent Note: 插件市场已安装状态检测与 Scoped 包名解析

Status: implemented

## 问题

在 `packages/dsh-market/src/client/install-source.ts` 中，`entryInstalled(entry, installed)` 原先仅执行单一的全等比对（`item.id === entry.id`）。

在 DSH Web 运行时环境中：
1. `dsh-plugin-manager` 从当前 Profile 的 `package.json` 读取已安装依赖，其 Key 是实际发布的包名（包含 npm scope，如 `@omdsh-dev/dsh-annotation`、`@a9i5k4/dsh-auto-memory`、`@noob-stupid/dsh-plugin-console`）。
2. 创意工坊市场清单（`community.json` / `plugins.json`）中登记的插件条目使用短标识符（如 `dsh-annotation`、`dsh-auto-memory`、`dsh-plugin-hub`）。
3. 此外，`community.json` 中的部分条目（如 `dsh-annotation` 和 `dsh-genui`）遗漏了明确的 `"npm"` 字段配置。

上述原因导致 `entryInstalled` 对已安装的 scoped 插件返回 `null`，使工坊 UI（`MarketCard.tsx`）未能渲染「已安装」徽章，并错误地显示主操作区「一键安装」按钮。

## 决策

1. **在 `install-source.ts` 中引入多维度已安装匹配规则**：
   - ID 与 Name 直接相等匹配（`item.id === entry.id || item.name === entry.id`）；
   - NPM 包名直接匹配（比对 `entry.npm`，支持剥离版本号后缀）；
   - Scope 剥离后比对（如将 `@omdsh-dev/dsh-annotation` 规范化为 `dsh-annotation` 与 `entry.id` 或 `entry.npm` 比对）；
   - Git 仓库规范化路径比对（统一解析 `entry.repo` 与 `item.source.spec` / `item.id` 为 canonical repo）。
2. **补全 `community.json` 元数据**：
   - 为 `dsh-annotation` 补充 `"npm": "@omdsh-dev/dsh-annotation"`；
   - 为 `dsh-genui` 补充 `"npm": "@omdsh-dev/dsh-genui"`。
3. **刷新构建产物**：
   - 重新生成 `market/dist/manifest/plugins.json` 并通过 `market:check` 校验。

## 权衡的替代方案

- **严格单字段匹配**：要求 `community.json` 的 entry ID 必须与 npm 包名一字不差。已拒绝：破坏外部已有 ID 会破坏点赞持久化、书签和链接稳定性。
- **仅在宿主侧做去 scope 规范化**：修改 `dsh-plugin-manager` 中的 `InstalledPluginItem.id`。已拒绝：宿主侧的 Profile 操作（如启停开关 `set-enabled`、卸载等）必须严格与 `package.json` 的真实依赖名保持一致。

## 影响

- 市场卡片能够精准识别所有 scoped 与 unscoped 社区插件的已安装状态；
- 已安装插件在市场界面中正确隐藏一键安装按钮，仅保留复制安装命令与已安装徽章；
- 单测与全量一致性门禁全部通过。
