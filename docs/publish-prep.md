# dsh-web-ui 插件包发布准备（内测已结束）

> **快照说明（重要）**：本文档是**当前时点（2026-08-13）**的发布前检查快照。
> 插件全家桶已结束内测，但**清单与版本仍可能调整**：包可能增删、版本可能调整、
> 字段可能变动。本文档需随仓库变更**重新核对**，不得当作永久事实使用。
>
> **红线（务必遵守）**：发布动作仍须先经仓库维护者明确批准，并按 registry 规范
> 操作（`npm pack --dry-run` 级别的演练可先行）。

## 一、范围

`packages/` 与 `packages/skins/` 下共 28 个插件包（截至快照日）：

| 目录 | 包名 | 当前版本 | private |
| --- | --- | --- | --- |
| packages/dsh-task-board | @linxin666/dsh-client-ui-task-board | 0.1.1 | true |
| packages/dsh-git-graph | @linxin666/dsh-client-ui-git-graph | 0.1.1 | true |
| packages/dsh-pet | @linxin666/dsh-pet | 0.1.1 | true |
| packages/dsh-remote-web-ui | @linxin666/dsh-remote-web-ui | 0.1.1 | true |
| packages/dsh-live-stats | @linxin666/dsh-live-stats | 0.1.1 | true |
| packages/dsh-ssh | @linxin666/dsh-ssh | 0.1.1 | true |
| packages/dsh-liangshen | @linxin666/dsh-liangshen | 0.1.12 | false |
| packages/dsh-aionui-panel | @linxin666/dsh-client-ui-aionui-panel | 0.1.1 | true |
| packages/dsh-web-ui-settings | @linxin666/dsh-client-ui-web-ui-settings | 0.1.1 | true |
| packages/dsh-community-plugins | @linxin666/dsh-client-ui-community-plugins | 0.1.17 | false |
| packages/dsh-tool-describe-image | @linxin666/dsh-tool-describe-image | 0.1.18 | false |
| packages/dsh-skins | @linxin666/dsh-skins（聚合） | 0.1.1 | true |
| packages/dsh-web-ui-all | @linxin666/dsh-web-ui-all（聚合） | 0.1.1 | true |
| packages/dsh-desktop-launcher | @linxin666/dsh-desktop-launcher | 0.1.0 | true |
| packages/dsh-skill-manager | @linxin666/dsh-skill-manager | 0.1.0 | true |
| packages/dsh-plugin-manager | @linxin666/dsh-plugin-manager | 0.1.0 | true |
| packages/dsh-shutdown | @linxin666/dsh-client-ui-shutdown | 0.1.18 | false |
| packages/skins/qq98 | @linxin666/dsh-client-ui-skin-qq98 | 0.1.1 | true |
| packages/skins/ths | @linxin666/dsh-client-ui-skin-ths | 0.1.1 | true |
| packages/skins/xp | @linxin666/dsh-client-ui-skin-xp | 0.1.1 | true |
| packages/skins/blue-fantasy | @linxin666/dsh-client-ui-skin-blue-fantasy | 0.1.1 | true |
| packages/skins/dragon-heir | @linxin666/dsh-client-ui-skin-dragon-heir | 0.1.1 | true |
| packages/skins/minecraft | @linxin666/dsh-client-ui-skin-minecraft | 0.1.1 | true |
| packages/skins/whale-song | @linxin666/dsh-client-ui-skin-whale-song | 0.1.0 | true |
| packages/skins/harbor | @linxin666/dsh-client-ui-skin-harbor | 0.1.14 | true |
| packages/skins/trading | @linxin666/dsh-client-ui-skin-trading | 0.1.2 | true |
| packages/skins/skin-center | @linxin666/dsh-client-ui-skin-center | 0.1.1 | true |
| packages/skins/miku | @linxin666/dsh-client-ui-skin-miku | 0.1.12 | true |

## 二、发布前检查结论（2026-08-11，已修复项标注 [已确认]）

### [阻断] 阻断项（不修复无法发布/无法被消费）

1. **全部 20 包 `private: true`** — npm 直接拒绝发布 private 包
   （`This package has been marked as private`）。发布前需逐个移除。
   **（发布前需按流程移除，当前仍保留）**
2. **聚合包 `workspace:*` 依赖原样进 tarball**（dsh-skins 7 处、dsh-web-ui-all 9 处）—
   [已确认] **已确认修复方式**：实测 `pnpm pack` 会把 `workspace:*` 改写为真实版本号
   （dsh-skins 7 处、dsh-web-ui-all 9 处全部改写为 0.1.1/0.1.0，无残留）。
   发布时必须用 **`pnpm publish`**（不要用 `npm publish`），`npm pack` 不改写。
3. **类型产物缺失（1 包）** — [已确认] **已修复**：
   - dsh-task-board：新增 `tsconfig.build.json`（emitDeclarationOnly → lib/types），
     build 脚本改为 `tsc -p tsconfig.build.json && tsdown`；已产出 18 个 .d.ts；
4. **`@deepseek-ai/dsh-code-kline` 未发布** — 原为 ui-code-kline 与 dsh-web-ui-all
   的依赖方（peerDeps/deps 引用），需在依赖它的包之前发布。
