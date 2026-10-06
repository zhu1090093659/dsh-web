# Agent Note: 插件更新门禁改为读取运行中 DSH 自身的清单

Status: implemented

## Problem

在打包的 DSH 桌面客户端上，插件页的「检查更新」区块把**每一个**声明了 `dsh.engines.dsh` 下限的插件都判为不兼容，显示「需要 DSH ≥ X，请先升级 DSH 再更新」并禁用更新按钮——即使运行中的 DSH 恰好满足该下限（#1819）。报告者的宿主运行 DSH `0.2.0-rc.2`，被提供的版本要求 `>=0.2.0-rc.2`。

版本门禁本身没有错，是宿主答不出来。只要 `cliAvailable()` 为 false，`probeDshVersion` 就返回 undefined，而 `cliAvailable()` 即 `findDshBinary() !== null`。在打包桌面端，当时存在的三条候选全部落空：

- PATH 上的 `dsh.cmd` / `dsh`：启动器只把 `<resources>/runtime/bin` 前置给它拉起的 host，而该目录里只有 `node`；CLI 启动器在兄弟目录 `<resources>/runtime/cli/bin`；
- host 入口上层的 `node_modules/.bin`：安装包剥除了所有 `.bin` 目录（符号链接 shim 无法在安装包中存活），何况 host 入口本就在 `app.asar` 内；
- `<packageRoot>/lib/bin.js`：私有 host 包只带 `lib/index.js` 与 `lib/cli.js`。

随后 `compatibleVerdict` 把无法核验的要求按 fail-closed 折叠成「不兼容」，浏览器半区再把它渲染成升级宿主本体的指令——把一个宿主从未证明存在的修复方向指给了用户。

## Decision

**运行版本在进程内读取，「无法核验」与「版本过低」是两个不同的判定。**

1. `resolveDshVersion` 优先读取安装自身 `@deepseek-ai/dsh` 清单的 `version`。官方运行时把该清单路径作为 `profileContext.installAnchor` 发布（官方插件管理器判断可移除性时读的也是这条事实），网关经 `launchedInstallAnchor` 接收，并在任何读取版本之前校验它是绝对且无穿越的路径。这是一次本地文件读取：没有子进程、不依赖 PATH、运行期不会过期，因此每次解析都重新读取、从不缓存。
2. `dsh --version` 保留为回退，服务于不发布 anchor（或清单读不出来）的运行时。探测原有的 TTL/冷却缓存继续存在，只是如今只管辖回退路径。
3. `findDshBinary` 新增打包桌面端候选：`<resources>/runtime/cli/bin/dsh.cmd`（Windows）或同目录的 `dsh`（其他平台）；资源根来自 `process.resourcesPath`，取不到时退而取运行中 host 入口第一个名为 `resources` 的祖先目录（大小写不敏感，以覆盖 macOS 的 `Resources`）。这同时修好了该宿主上的 CLI 写入，不只是版本探测——两条路径共用同一次发现。
4. 只要宿主读到了版本，check-updates 行就带上 `hostVersion`。它的缺失正是浏览器渲染「无法确认本机 DSH 版本」的依据；它与 `compatible: false` 同时出现时渲染升级指令。新增 `updateUnverifiedDsh` 键（zh/en 以及集中维护的 ru 字典）承载这段文案，两个界面都输出 `data-update-compat-reason` / `data-update-row-compat-reason`，使这一区分可被断言。

## Alternatives considered

- **只补桌面端 CLI 路径候选（#1819 的第一条建议）。** 否决其作为主要修复：它修好了发现路径，却仍让版本门禁依赖「起一个进程」来回答进程自己已经知道的问题，而且任何因其他原因缺 CLI 的宿主依旧会得到「请升级 DSH」。它作为写入路径的真实第二处修复被保留。
- **不校验 anchor 直接读取。** 否决：它和 profile 目录、patch 路径一样，是经上下文服务从包外传来的，本包消费的每一条外来事实都要先校验。
- **像 CLI 探测那样缓存进程内版本。** 否决：文件读取重复一次没有成本，缓存反而会让长驻宿主在安装被替换后继续回答它已不再运行的版本。
- **把无法核验的要求按兼容放行（fail open）。** 否决：#754 有意 fail-closed，使更新永不运行在宿主无法证明兼容的运行时上。缺陷在文案而不在判定——判定保留，文案拆开。
- **无法核验时干脆不提这条要求。** 否决：该行仍被拦住，而一个没有任何解释的禁用按钮比「无法确认版本」更糟。

## Consequences

- 打包桌面端在完全没有 CLI 的情况下也能判定兼容门禁；有 CLI 的宿主同样改为进程内解析，因此在所有运行时上都更快。
- `findDshBinary` 现在能找到桌面端 CLI 启动器，因此此前报「dsh CLI not found on PATH」的安装、更新与卸载也能走通 CLI 路径。
- 线协议在更新行上新增 `hostVersion`；`parseUpdateList` 校验它是字符串，缺失时不丢任何字段，因此旧宿主返回的行仍能解析。
- 既不发布 anchor 也够不到 CLI 的运行时仍会拦住已声明的要求，但文案如实。
- PATH 优先于桌面端候选，用户自己的 `dsh` 不会被遮蔽。

## Testing

- `packages/dsh-plugin-manager/tests/gateway.spec.ts`：经 `resourcesPath` 发现桌面端 CLI、仅凭 host 入口发现（macOS 大写 `Resources`）、PATH 对其的优先级，以及不会从无关的 `resources` 目录凭空造出候选。
- `packages/dsh-plugin-manager/tests/update-route.spec.ts`：`cliAvailable()` 为 false 且不注入版本 seam 时，更新由 install anchor 放行；同一宿主在 anchor 声明确实更旧的 DSH 时被拦（并点名读到的版本）；check-updates 行携带 `hostVersion`；两个来源都答不出时该行省略它。无法核验要求的 412 文案不再点名 `dsh --version`。
- `packages/dsh-plugin-manager/tests/PluginUpdatePatch.spec.tsx`：带宿主版本的被拦行渲染升级文案，不带宿主版本的行渲染「无法确认」文案——并断言其反面，使旧误导文案无法回归。
- 本次改动运行的检查：包级 `typecheck` 与 `vitest run`（320 个用例）、`pnpm docs:write-pair packages/dsh-plugin-manager`，以及仓库基线（`pnpm typecheck`、`pnpm test`、`pnpm test:scripts`、`pnpm docs:check`、`pnpm i18n:check`、`pnpm emoji:check`、`pnpm test:standards`）。
