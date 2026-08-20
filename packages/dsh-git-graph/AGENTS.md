# AGENTS.md — dsh-git-graph

dsh Web GUI 的外部 git 上下文插件（项目选择器 + 分支选择器 + Git 图谱）。主仓（sibling checkout，路径见 README）零改动；本仓是自包含的 cordis 插件包，作为 dsh profile bundle 激活。

## 仓库规则

- **遵循 turtle-ui 规范**：独立 pnpm 包（`"type": "module"`，node `^22.19 || >=24`，packageManager pnpm），peer APIs 走 `@deepseek-ai/dsh-*` peerDependencies + `autoInstallPeers: false`，`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` 声明 bundle 激活。
- **tsconfig 分层**：`tsconfig.json` 是 solution（`files: []`），`tsconfig.host.json`（host half）与 `tsconfig.client.json`（browser half）各自成 program——host 侧 `sessions: SessionStore` merge 与浏览器侧 `sessions: ISessions` merge 不得同 program（主仓 one-program-per-side 规则）。`tsconfig.vitest.json` 为测试 program（排除 `src/index.ts`/`src/invariant.ts`，它们只由 host project 检查）。
- **浏览器 bundle 纪律**：`@deepseek-ai/*` 只能 type-only 导入（构建期纯度门）；值导入只允许平台种子表成员（react / cordis / ui-slots / ui-primitives）。跨插件协作走 cordis 服务（`ctx.slots` / `ctx.sessions` / `ctx.workspaces`）。
- **build 预设是副本**：`build/tsdown.client.ts` 与 `build/web/src/platform.ts` 复制自主仓 `packages/client/`，主仓更新时同步。
- **git 能力不进模型可见面**：git switch/create 是 UI 触发的宿主操作，不写 session log、不产生模型输入。
- **文案中英双语**：词典在 `src/client/locales.ts`（`zh` 为 key 源，`en` 键集完整对照），错误文案对照 ZCode branchSwitcher 词汇。
- **新增源码文件必须可被 host/client program 覆盖**：host 侧进 `src/host/`，浏览器侧进 `src/client/`，纯逻辑进 `src/core/`（两侧共享，双 program 都会编译）。

## 提交前检查

```sh
pnpm run typecheck
pnpm test
pnpm run build
```
