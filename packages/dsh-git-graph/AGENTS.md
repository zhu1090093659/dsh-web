# AGENTS.md — dsh-git-graph

dsh Web GUI 的外部 git 上下文插件（项目选择器 + 分支选择器 + Git 图谱）。本包是自包含的 cordis 插件包，作为 dsh profile bundle 激活，不修改宿主仓库。

## 仓库规则

- **遵循 turtle-ui 规范**：独立 pnpm 包（`"type": "module"`，node `>=24.9`，packageManager pnpm），peer APIs 走 `@deepseek-ai/dsh-*` peerDependencies + `autoInstallPeers: false`，`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` 声明 bundle 激活。
- **tsconfig 分层**：`tsconfig.json` 是 solution（`files: []`），`tsconfig.host.json`（host half）与 `tsconfig.client.json`（browser half）各自成 program——host 侧 `sessions: SessionStore` merge 与浏览器侧 `sessions: ISessions` merge 不得同 program（主仓 one-program-per-side 规则）。`tsconfig.vitest.json` 为测试 program（排除 `src/index.ts`，它只由 host project 检查）。
- **浏览器 bundle 纪律**：`@deepseek-ai/*` 只能 type-only 导入（构建期纯度门）；值导入只允许平台种子表成员（react / cordis / ui-slots / ui-primitives）。跨插件协作走 cordis 服务（`ctx.slots` / `ctx.sessions` / `ctx.workspaces`）。
- **共享构建预设**：`tsdown.config.ts` 与 `tsdown.prepare.config.ts` 都 import 仓库根 `shared/tsdown.client.ts`（平台种子表 `shared/web-platform.ts`），包内不保留副本；规则见 [packages/AGENTS.md](../AGENTS.md)。
- **git 能力默认不进模型可见面**：UI 触发的宿主操作（switch/create/worktree 动词）不写 session log、不产生模型输入。唯一例外是 opt-in 的 `agentTool` 设置（默认关）：开启后注册模型可见的 `git_worktree` 工具（create/list/remove，作用于 `$DSH_HOME/worktrees/` 托管目录），这是对本规则的有意豁免，决策见 Agent Note `.agents/notes/implemented/feature/2026-08-26-git-worktree-parallel-sessions.md`。
- **文案中英双语**：词典在 `src/client/locales.ts`（`zh` 为 key 源，`en` 键集完整对照），错误文案对照 ZCode branchSwitcher 词汇。
- **新增源码文件必须可被 host/client program 覆盖**：host 侧进 `src/host/`，浏览器侧进 `src/client/`，纯逻辑进 `src/core/`（两侧共享，双 program 都会编译）。

## 提交前检查

```sh
pnpm run typecheck
pnpm test
pnpm run build
```
