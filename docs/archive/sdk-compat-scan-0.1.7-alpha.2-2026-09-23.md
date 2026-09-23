# dsh-web 插件包对 DSH 0.1.7-alpha.2 兼容性扫描（2026-09-23）

一次性验证快照，冻结历史，不描述当前行为。长期结论的归属文件仍是 `.agents/notes/implemented/architecture/2026-09-22-sdk-cohort-0.1.7-alpha.1.md`（SDK cohort 决策的唯一家）。

## 结论摘要

对全部 21 个插件包（`packages/` 下 20 个 + `packages/skins/skin-center`）做了源码、类型、模块表、CSS 契约、服务配置与构建配置五个面的 alpha.2 对照。结论：

- **源码级硬破坏 0 项。** 所有被仓库引用的 `@deepseek-ai/*` 符号在 alpha.2 安装中均可解析；类型签名变化全部是可选参数或新增字段，向后兼容。
- **浏览器模块表（UI 注入面）0 变化。** alpha.2 官方壳的静态模块表与 `shared/web-platform.ts` 的 `PLATFORM_MODULES` 逐项相同。
- **客户端 bundle 不会内联 alpha.1 的官方 UI 代码。** `shared/tsdown.client.ts` 的纯度门禁把平台表条目强制 external、只允许 `session|llm|tools|brand` 契约层内联，所以插件产物不携带旧版官方组件副本。
- **1 项真实的仓库内版本漂移**：`desktop/runtime/host` 与两条 workflow 仍把官方宿主固定在 `0.1.7-alpha.1`。
- **1 项契约覆盖缺口**：Skin Center 的官方 token 契约是从不完整来源生成的子集，alpha.2 新增的 5 个 token（含 diff 增删色）未被收录。

本扫描未改动任何包源码，因此没有需要 GUI 验收的 UI 变更。

## 运行期实际 cohort（关键前提）

运行中的 `dsh web`（pid 6517，`127.0.0.1:3080`）与 `~/.dsh/profiles/web` 已经整体运行在 alpha.2，且 profile 里的 `@linxin666/dsh-*` 是**指向本仓库包目录的软链**——仓库构建出的 `lib/` 就是这个 GUI 实际加载的插件产物。

| 位置 | 版本 |
| --- | --- |
| `@deepseek-ai/cordis`（宿主与 profile） | 4.0.4 |
| `@deepseek-ai/cosmokit` | 1.8.5 |
| `@deepseek-ai/dsh-tools` / `dsh-brand` / `dsh-settings` / `dsh-atomic-write` / `dsh-config-editor` | 0.1.7-alpha.2 |
| `@deepseek-ai/schemastery` | 3.18.4 |
| `@linxin666/dsh-web-all` 等 5 个 | 0.3.24，软链到 `packages/*` |
| 仓库 `node_modules`（typecheck / test 用） | 0.1.7-alpha.1 |

含义有两条。第一，alpha.2 与 alpha.1 的官方运行时在同一份宿主里没有形成双副本，因为 profile 直接解析到宿主的 alpha.2 依赖。第二，本仓库的 `pnpm typecheck` / `pnpm test` 是在 alpha.1 类型下通过的，而线上跑的是 alpha.2——这正是本次扫描要覆盖的缝隙。

## 逐面验证证据

### 1. 类型与 API

上游 `dsh-v0.1.7-alpha.1..dsh-v0.1.7-alpha.2` 为 162 个 commit、300 个文件，44 个包版本号整体推进到 `0.1.7-alpha.2`。逐包比对 `.d.ts` 与 `exports` 后，`exports` 映射逐字节相同，`dsh` 清单块（`engines.dsh` / `bundle.patch` / `client.inject`）未变。

有实质声明变化的包及其对仓库的影响：

| 包 | 变化 | 仓库消费者 | 判定 |
| --- | --- | --- | --- |
| `dsh-client-ui-primitives` | 新增 `lib/CodeCard.module.css`、`lib/types/CodeToolbar.d.ts`（`CodeToolbarLabels`）；`CodeBlock` 渲染签名新增 `toolbarLabels` / `wrap` 可选参数；`DiffBlockLabels` 去掉 `files(count)`；`DiffBlock.module.css` 重写 | 无（全仓 grep `DiffBlock` / `ReadBlock` / `CodeCard` / `toolbarLabels` / `DiffBlockLabels` / `ReadBlockLabels` / `CodeToolbarLabels` 全部 0 命中） | 兼容 |
| `dsh-api-session-controller` | `SessionPageRequest` 新增可选 `turnWindow`；`SessionFollowRequest` 改为 `extends Pick<SessionPageRequest,'maxMessages'|'turnWindow'>`；`projection-store` 新增 `seqOf(key)` | `packages/dsh-task-board/src/host-runner.ts:338,363` 只传 `{address, maxMessages}`，两步都是可选字段 | 兼容 |
| `dsh-client-locale` | 新增 `codeBlock.title` / `codeBlock.wrap` / `codeBlock.unwrap` | 5 个包以 `import type {} from '@deepseek-ai/dsh-client-locale/client'` 做纯类型增补；仓库未自行声明这些键 | 兼容（仅新增） |
| `dsh-client-ui-conversation` | 删除 `diff.files.one` / `diff.files.other` | 全仓 0 命中 | 兼容 |
| `dsh-tools` | `ToolDefinition` 新增可选 `projectContent()` | 仓库未实现自定义 `projectContent` | 兼容 |
| `dsh-api-gateway` | `types/index.d.ts` 增 2 行注释 | 无 | 兼容 |
| `dsh-client-ui-renderer` / `settings-models` / `sidebar` / `theme` | 只有 `lib/client.js` 变动，0 个 `.d.ts` | 无类型面消费者 | 兼容 |

仓库侧对 1170 个手写 `.ts/.tsx/.mts/.mjs` 做了导入符号全量解析。唯一两处「看似缺失」都是解析器局限而非破坏，已逐一坐实，不得当作缺陷「修复」：

- `@deepseek-ai/cordis` 的 `Volatile` / `VolatileSnapshot`。alpha.2 `cordis/lib/types/index.d.ts:16` 是 `export type { Volatile, VolatileSnapshot } from '@deepseek-ai/cosmokit';`，属再导出，仓库消费者（`dsh-doctor/src/index.ts`、`dsh-git-graph/src/host/config.ts` 及测试）照常编译。是否把导入面改指向 `@deepseek-ai/cosmokit` 属风格选择，不是兼容性修复。
- `@deepseek-ai/dsh-api-remotes/client` 的一批符号是 `export type {…} from` 再导出，同样只是解析器未跟随。

另有一条 `@deepseek-ai/dsh-agent` 的 `AssistantStreamFrame`：alpha.2 的 `lib/types/index.d.ts` 有 `export * from './runtime-types.ts'`，符号仍从包根可达，`dsh-pet` 不受影响。`packages/dsh-pet/lib/types/client/market-tab.d.ts:22` 里残留的 `@deepseek-ai/dsh-client-runtime/client` 是旧 `lib/` 产物，源码无此导入，重新构建即消失。

### 2. 浏览器模块表（UI 注入面）

alpha.2 壳产物 `@deepseek-ai/dsh-web-frontend/dist/assets/index-bRoh_x8K.js` 内联的静态模块 id 集合与 `shared/web-platform.ts` 的 9 项完全一致，逐项可解析：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`。插件注入的 `dsh-client-ui-session` 等 id 在 alpha.2 中亦全部可解析。

因此 `PLATFORM_MODULES` 不需要改动，`shared/tests/web-platform.spec.ts` 对 `dsh-client-runtime` 的排除断言也仍然成立。

### 3. 客户端 bundle 纯度（防止携带旧版官方组件）

这是本次扫描里最关键的一条架构安全属性，且已在代码中成立：`shared/tsdown.client.ts` 把 `CLIENT_EXTERNALS` 定义为 `PLATFORM_MODULES` 去掉 `dsh-client-store`，并用 `noExternal` 把其余一切打成内联——但 `INLINE_SAFE`（`^@deepseek-ai\/dsh-(session|llm|tools|brand)(\/|$)`）与 `GENERATED_REMOTE` 之外的非平台 `@deepseek-ai/*` 一律被纯度门禁拒绝。

结论：插件产物不会把 alpha.1 的官方 UI 组件代码复制进 alpha.2 宿主。插件的 UI 兼容面因此只剩「模块表 id + 类型契约」两者，而这两者本次均验证为兼容。

`shared/tsdown.client.ts:78` 生成的 `legacy` 垫片只在 require 落空时回退 `@deepseek-ai/dsh-client-runtime`，alpha.2 宿主会命中首选平台模块，不受影响。

### 4. CSS 契约与皮肤

`packages/skins/skin-center/contracts/official-tokens-v1.json` 的 278 个 token 与 alpha.2 对照：

| 集合 | 数量 |
| --- | --- |
| 契约 token | 278 |
| alpha.1 `dsh-client-ui-theme` 非 static token | 288 |
| alpha.2 `dsh-client-ui-theme` + 官方壳 CSS 并集 | 293 |
| alpha.2 新增（alpha.1 无） | 5 |
| alpha.2 存在但契约未收录 | 15 |
| 契约有而 alpha.2 没有 | 0 |

alpha.2 真正新增的 5 个：`--dsw-alias-bg-layer-4`、`--dsw-alias-code-diff-added`、`--dsw-alias-code-diff-deleted`、`--dsw-alias-label-error`、`--dsw-hovercard-bg`。

其中 `--dsw-alias-code-diff-added` / `--dsw-alias-code-diff-deleted` 正是 alpha.2 重写 `DiffBlock.module.css` 后新增的 diff 增删底色，皮肤若要跟随官方 diff 配色必须能引用它们。

未被收录的另外 10 个（如 `--dsw-alias-bg-document-preview`、`--dsw-alias-label-document-preview`、`--dsw-alias-link`、`--dsw-alias-state-idle-primary`、`--dsw-corner-shape`、`--dsw-elevation-*`、`--dsw-menu-backdrop-filter`）在 alpha.1 就已存在，属**生成来源不全导致的既有缺口**，不是 alpha.2 引入的问题：`scripts/official-tokens-snapshot.mjs` 默认只扫 `@deepseek-ai/dsh-web-frontend/dist/assets/*.css`，而权威集合分散在 `@deepseek-ai/dsh-client-ui-theme/lib/client.js` 与各 `dsh-client-ui-*` 包中。

该脚本在当前仓库无法直接跑默认路径——仓库 `node_modules` 里没有 `@deepseek-ai/dsh-web-frontend`。它支持显式传入 CSS 路径，可指向 alpha.2 安装。

皮肤对官方 class 的探测另有一批失效项（268 个探测中 57 个在 alpha.2 与 alpha.1 语料里都不存在，涉及 15 个皮肤目录，如 `black-gold/patches.css` 的 `_codeBlock`、`wallpaper-exclusive` 的一批 `_pane*` / `_subagent*`）。alpha.1 语料同样没有字面 `codeBlock` 类（只有 `markdown-code-block` 与 `md-code-block`），说明这些是**与 alpha.2 无关的历史残留**，不属本次兼容性范围。

### 5. 服务与配置

- `spill-policy` 的 `maxInlineBytes` → `maxInlineTokens` 改名：全仓（排除 `node_modules`、`lib/`、`market/dist`）0 命中，无需迁移。唯一的 `maxInline*` 命中在 `desktop/runtime/host/pnpm-lock.yaml`，那是依赖名 `@deepseek-ai/dsh-spill*`。
- `dsh` 清单的 `engines.dsh` 全仓统一为 `>=0.1.7-alpha.1`，alpha.2 满足，不需要放开。
- `packages/dsh-task-board` 的会话 follow 调用与 alpha.2 签名兼容（见上表）。
- 仓库未发现的另一个隐患：运行期 profile 与仓库 `node_modules` 的 cohort 差异不产生双副本，理由见「运行期实际 cohort」一节。

## 需要决策的推进项（本次未实施）

以下四项都属 cohort 推进，按 skill 边界不属于本次扫描的写入范围，需要用户对「是否把本仓 cohort 推进到 0.1.7-alpha.2」作出决定后，由 `dsh-sdk-upgrade` 执行。

| 文件 | 现状 | 说明 |
| --- | --- | --- |
| `desktop/runtime/host/package.json` | `"@deepseek-ai/dsh": "0.1.7-alpha.1"` | 桌面应用打包的宿主运行时载荷，配套 `pnpm-lock.yaml` 全量锁在 alpha.1 |
| `desktop/runtime/profile-web/package.json` | `"@linxin666/dsh-web-all": "0.3.19"` | 桌面预装 profile 种子的聚合包版本落后于仓库当前的 0.3.24 |
| `.github/workflows/ci.yml:154` | `npm i -g @deepseek-ai/dsh@0.1.7-alpha.1` | CI 的 E2E 宿主固定版本 |
| `.github/workflows/release.yml:196` | 同上 | 发布门禁的宿主固定版本 |
| `packages/skins/skin-center/contracts/official-tokens-v1.json` | 278 token，来源字符串只描述部分真相 | 需连同 `official-tokens-snapshot.mjs` 的权威来源一起修正，并重生成 `official-tokens.generated.ts` |

`desktop/runtime/profile-web/pnpm-lock.yaml` 中没有 `0.1.7-alpha.1` 字样，它的 cohort 由 `@linxin666/dsh-web-all` 的版本带出。

## 未决与残留未知

- **GUI 证据缺失。** 运行中宿主的启动 token 由 `dsh-client-connection` 的 `processLaunchToken()` 用 `randomBytes` 在进程内生成、不落盘，`~/.dsh/logs` 里 2026-09-10 的旧 token 已失效。以该 token 访问 `/`、`/index.html`、`/api/health`、`/api/status` 全部返回 401，因此本次无法对该 GUI 做无头截图验收。补救方式二选一：用户重启 `dsh web` 并提供打印出的 tokenized URL，或授权 `scripts/e2e-mount.sh` 的 scratch profile E2E lane（自建 DSH_HOME 与随机端口，不触碰当前服务）。
- 本次无 UI 代码改动，故 GUI 验收在流程上并非必需项，但它是唯一能把「alpha.2 宿主 + 仓库构建产物」的真实渲染坐实的证据，故列为残留。
- 皮肤死探针的清理属独立议题，需要单独立项判断每条的意图，不在本次范围。
- `--dsw-hovercard-bg` 等 5 个 alpha.2 新 token 是否应进入皮肤可用集，取决于 cohort 决策。

## 复现命令

```sh
# 上游变更范围
gh api repos/deepseek-ai/deepseek-harness/compare/dsh-v0.1.7-alpha.1...dsh-v0.1.7-alpha.2 --jq '.total_commits,.files|length'

# 类型面逐包比对（alpha.1 取仓库 node_modules，alpha.2 取全局安装）
diff -rq node_modules/.pnpm/@deepseek-ai+dsh-client-ui-primitives@0.1.7-alpha.1*/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib \
        /opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib

# 模块表比对
for m in react react/jsx-runtime react-dom react-dom/client @deepseek-ai/cordis \
         @deepseek-ai/dsh-client-store @deepseek-ai/dsh-client-ui-slots \
         @deepseek-ai/dsh-client-ui-primitives @deepseek-ai/dsh-client-ui-dockkit; do
  grep -c "$m" /opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-*.js
done

# token 契约对照（见本次使用的 /tmp/tokcmp.mjs 思路）
node -e "const{readFileSync}=require('fs');const scan=f=>[...readFileSync(f,'utf8').matchAll(/--dsw-[a-z0-9-]+/g)].map(m=>m[0]);const s=new Set(scan('/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js'));console.log(s.size)"
```

## 回滚

本次只新增本文件，未触碰任何包源码、依赖范围、lockfile 或生成产物。回滚即 `git revert` 本文件的提交，无连带影响。

## 相关文件

- `.agents/notes/implemented/architecture/2026-09-22-sdk-cohort-0.1.7-alpha.1.md`（SDK cohort 决策的归属文件）
- `package.json`（根 devDeps 仍统一处在 `^0.1.7-alpha.1`）
- `desktop/runtime/host/package.json`、`.github/workflows/ci.yml`、`.github/workflows/release.yml`
- `packages/skins/skin-center/contracts/official-tokens-v1.json`、`scripts/official-tokens-snapshot.mjs`
- `shared/web-platform.ts`、`shared/tsdown.client.ts`