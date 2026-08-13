# dsh-web-ui 插件包发布准备（内测已结束）

> **快照说明（重要）**：本文档是**当前时点（2026-08-13）**的发布前检查快照。
> 插件全家桶已结束内测，但**清单与版本仍可能调整**：包可能增删、版本可能调整、
> 字段可能变动。本文档需随仓库变更**重新核对**，不得当作永久事实使用。
>
> **红线（务必遵守）**：发布动作仍须先经仓库维护者明确批准，并按 registry 规范
> 操作（`npm pack --dry-run` 级别的演练可先行）。

## 一、范围

`packages/` 与 `packages/skins/` 下共 19 个插件包（截至快照日）：

| 目录 | 包名 | 当前版本 | private |
| --- | --- | --- | --- |
| packages/dsh-task-board | @linxin666/dsh-client-ui-task-board | 0.1.1 | true |
| packages/dsh-git-graph | @linxin666/dsh-client-ui-git-graph | 0.1.1 | true |
| packages/dsh-pet | @linxin666/dsh-pet | 0.1.1 | true |
| packages/dsh-remote-web-ui | @linxin666/dsh-remote-web-ui | 0.1.1 | true |
| packages/dsh-live-stats | @linxin666/dsh-live-stats | 0.1.1 | true |
| packages/dsh-ssh | @linxin666/dsh-ssh | 0.1.1 | true |
| packages/dsh-aionui-panel | @linxin666/dsh-client-ui-aionui-panel | 0.1.1 | true |
| packages/dsh-web-ui-settings | @linxin666/dsh-client-ui-web-ui-settings | 0.1.1 | true |
| packages/dsh-skins | @linxin666/dsh-skins（聚合） | 0.1.1 | true |
| packages/dsh-web-ui-all | @linxin666/dsh-web-ui-all（聚合） | 0.1.1 | true |
| packages/skins/qq98 | @linxin666/dsh-client-ui-skin-qq98 | 0.1.1 | true |
| packages/skins/ths | @linxin666/dsh-client-ui-skin-ths | 0.1.1 | true |
| packages/skins/xp | @linxin666/dsh-client-ui-skin-xp | 0.1.1 | true |
| packages/skins/blue-fantasy | @linxin666/dsh-client-ui-skin-blue-fantasy | 0.1.1 | true |
| packages/skins/dragon-heir | @linxin666/dsh-client-ui-skin-dragon-heir | 0.1.1 | true |
| packages/skins/minecraft | @linxin666/dsh-client-ui-skin-minecraft | 0.1.1 | true |
| packages/skins/whale-song | @linxin666/dsh-client-ui-skin-whale-song | 0.1.0 | true |
| packages/skins/trading | @linxin666/dsh-client-ui-skin-trading | 0.1.2 | true |
| packages/skins/skin-center | @linxin666/dsh-client-ui-skin-center | 0.1.1 | true |

## 二、发布前检查结论（2026-08-11，已修复项标注 [已确认]）

### [阻断] 阻断项（不修复无法发布/无法被消费）

1. **全部 19 包 `private: true`** — npm 直接拒绝发布 private 包
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
   **（发布动作本身，无法提前修复；发布顺序已排定）**
   [已确认] **已失效**：2026-08-12 调整移除 code-kline / ui-code-kline 包后，
   该发布依赖不再存在，无需处理。

### [建议] 建议项（registry 安装兼容性）— [已确认] 已修复

5. **peerDeps 版本声明不匹配**：git-graph / live-stats / pet / remote-web-ui
   的 `@deepseek-ai/*` peerDeps
   已从旧 `^0.0.1` 系列改为 **`^0.1.0-rc.6`**（与 npm 已发布版本匹配，避免 ERESOLVE）。

### [卫生] 卫生项

6. **LICENSE 文件缺失 11 包** — [已确认] **已补全**（BSD-3-Clause，dsh-external
   contributors），打包验证 LICENSE 已进 tarball。
7. **files 缺 `cordis.patch.yml`**（发布后 bundle patch 缺失会装不上）—
   [已确认] **已补全**：task-board / live-stats
   的 files 均加入 `cordis.patch.yml`（task-board 同时补齐
   `src` 与 `lib/types/**/*.d.ts.map`）。打包验证全部进 tarball。
8. **blue-fantasy 打包警告**：`MODULE_TYPELESS_PACKAGE_JSON`（packages/skins/
   无 package.json，`tsdown.client.ts` 被按 CJS 重解析）与 tsdown
   `external` 弃用提示。构建卫生问题，**不影响产物正确性**（打包产物正常），
   未改动，待官方 tsdown 配置演进后统一处理。

## 三、兼容性现状（npm 版 DSH × 插件）

2026-08-13 用隔离环境（`DSH_HOME` 隔离 + `dsh plugin add link:`）实测
npm 版 `@deepseek-ai/dsh@0.1.0-rc.6`：

- web GUI 启动正常（HTTP 200），`dsh plugin` 安装 task-board / blue-fantasy 成功；
- boot manifest 正确注册插件，`/plugins/@deepseek-ai/<pkg>/client.js` 可访问（200）；
- 日志无 error/warn，插件 `dsh.client` 声明（platform/inject/exports["./client"]）
  与 npm 版 `dsh-client-modules` 消费逻辑逐字段吻合。

npm 侧已发布 @deepseek-ai 核心 SDK 包至 `0.1.0-rc.6`，插件包仍按本仓库版本管理。

## 四、建议的发布流程（批准后执行）

1. 同步官方版本号节奏（当前为 `0.1.0-rc.6`，与 @deepseek-ai/dsh 对齐）；
2. 发布前仍需处理：移除 `private: true`（19 包）；
3. 按依赖顺序发布（用 **`pnpm publish`**，自动改写 workspace:*）：
   各功能包 > 皮肤包 > dsh-skins > web-ui-all；
4. 逐包 `pnpm pack --dry-run` 复核 tarball 内容（注意：dry-run 仍会执行
   prepack/prepare 脚本）；
5. 发布动作前**必须**经维护者确认。

## 五、重新核对时机

插件清单或版本发生任何变更后（新增/删除包、升版本、改字段），本节结论即失效，
需重新执行本文档的检查流程（字段扫描 + pack 演练 + peerDeps 核对）。
