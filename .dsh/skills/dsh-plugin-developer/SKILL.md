---
name: dsh-plugin-developer
description: Develop a new cordis bundle plugin for DeepSeek Harness in the dsh-web-ui repo (the DSH Web GUI plugin family) — scaffold with scripts/dsh-plugin-new, implement the host/client/core halves, register the package into the family aggregate, build and test with the shared tsdown client preset, and verify local mounting through link-profile. Use when the user asks to create, add, develop, extend, or debug a dsh-web-ui family plugin (新建/开发/修改一个 dsh-web-ui 插件), or to write a cordis plugin that mounts into deepseek-harness.
whenToUse: The user wants a new family plugin (新建/开发/新增一个插件), or wants to extend an existing one (如 dsh-task-board / dsh-ssh 加功能), or asks how cordis plugins are structured and mounted in the dsh-web-ui repo. Not for skins (see skin-developer), releases (see dsh-web-ui-release), or plugins inside the deepseek-harness repo itself.
---

# dsh-web-ui 插件开发（cordis bundle）

本技能指导在 dsh-web-ui 仓库里从零开发一个 deepseek-harness 的 cordis 插件（Web GUI
功能插件），并让它进入全家桶、构建、测试、本地挂载验证。参照实现：`packages/dsh-task-board/`
（UI 类）、`packages/dsh-ssh/`（host 重）、`packages/dsh-tool-describe-image/`（工具类、
无配置加载）。

## 核心模型（先读，决定一切写法）

- **cordis 五概念**（[DSH cordis-primer](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/cordis-primer.md)）：插件是实现 Service 的对象（函数式 `apply(ctx)` 最常见）；`ctx` 是服务仓库（`ctx.tools` / `ctx.sessions` / `ctx.systemPrompt` …）；用 `inject` 声明依赖（等待服务就绪，不手工排序）；事件分 emit / waterfall / parallel / serial 四种分发；**所有注册都是可逆效果**——经 `ctx.effect(() => () => {...}, '标签')` 或 `ctx.on()` 安装，卸载时自动回收。
- **DSH 挂载模型**：插件 = npm 包 + `cordis.patch.yml`（bundle patch 层）。`package.json` 的 `dsh.bundle.patch` 指向 patch 文件；patch 里的 `- insert:` 行把插件行插入 profile 组合。挂载走 `dsh plugin --profile <name> add link:<repo>/packages/<name>` + profile node_modules 链接，**绝不修改 DSH 源码**。
- **双半区**：`src/index.ts` 是 host 半区（运行在 dsh host 进程：系统提示词、工具、路由、设置命名空间）；`src/client/` 是 browser 半区（Web GUI 侧：React 视图、DOM 注入、槽位），经 `dsh.client` 声明注入；`src/core/` 是两侧共享的纯逻辑（两侧 program 都编译）。新增源码必须落在三区之一。
- **跨插件协作只走 cordis 服务 / slot**（`ctx.slots` / `ctx.sessions` / `ctx.workspaces` / 事件），**禁止值导入兄弟插件**（构建纯度门会拒绝，见下文）。

## 0. 前置

```sh
cd <dsh-web-ui 克隆根>
pnpm install        # 首次；依赖解析官方 NPM SDK（registry.npmjs.org）
```

先读 `packages/dsh-task-board/` 的 `src/index.ts`、`src/client/index.ts` 与
`package.json`，理解 host/client 契约与 bundle 清单。构建/类型/测试全部以
node_modules 的 `@deepseek-ai/*` SDK 包为唯一类型来源，克隆后无需任何源码 checkout。

## 1. 脚手架

```sh
node scripts/dsh-plugin-new <name>   # 如 pinboard：名字限小写字母、数字、单连字符
mv packages/<name> packages/dsh-<name>   # 目录按家族惯例加 dsh- 前缀（包名保持
                                         # @linxin666/dsh-client-ui-<name>，不要双重 dsh）
```

生成 `packages/<name>/` 标准 bundle 骨架。生成后**立即改两处**（模板默认值，全家桶
不接受）：
- `package.json`：**删除 `"private": true`**（否则 `pnpm -r publish` 跳过该包，聚合
  依赖在别的机器解析失败）；`license` 改为 `Apache-2.0`；补 `./invariant` 子路径导出
  与 `LICENSE` 文件（Apache-2.0 全文，参照 `packages/dsh-task-board/LICENSE`）。
- `cordis.patch.yml`：确认 insert 行 `id: ui-<name>` / `name: '@linxin666/dsh-client-ui-<name>'`
  与 npm 发布名一致（UI 类包按惯例 `@linxin666/dsh-client-ui-*`；host 重的工具类包用
  `@linxin666/dsh-*`，参照 dsh-ssh / dsh-tool-describe-image）。

## 2. 包契约（硬性约束，违反会挂评审）

- `package.json`：`"type": "module"`、node `^22.19 || >=24`；`dsh.bundle.patch` 指向
  `./cordis.patch.yml`；`dsh.client` 声明 `inject: ["@deepseek-ai/dsh-client-runtime", ...]`
  与 `platform: "web"`；exports 提供 `.`（host）、`./client`（浏览器半区）、必要时
  `./invariant`、`./src/*`（测试引用）。
- **tsconfig 自包含**：`moduleResolution: "bundler"` + `allowImportingTsExtensions`；
  **禁止** `extends` / `paths` / `references` 指向任何 DSH 源码 checkout（历史形态已废除）。
- **构建预设只用共享副本**：`tsdown.config.ts` 写 `import { clientBundle } from '../../shared/tsdown.client.ts'`，
  **禁止把预设复制进包内**。
- README 三件套：`README.md`（英文）+ `README.zh.md`（中文）+ `README.i18n.yaml`
  （配对 hash 记录），含 功能/安装/配置/已知限制 四节（涉及安全的包另加「安全模型」）。
  编辑任一侧后同步另一侧并 `pnpm docs:write-pair <包名>` 重录 hash。
- 包级 `AGENTS.md`：跨目录约定、执行/调度语义、安全模型等本包特有规则（参照
  `packages/dsh-task-board/AGENTS.md`）。
- 测试：`tests/` 下 vitest，行为变化必须带测试（详见第 7 节）。
- **全仓禁 emoji**：代码、注释、文档、提交信息、tag 一律不用（CI 全树扫描）。

## 3. host 半区（src/index.ts）

- `inject` 按需声明所需服务：`['systemPrompt']`（播报）、`['tools']`（工具）、
  `['webServer']`（路由）、`['settings']` 等；参照 dsh-ssh 的
  `export const inject = ['webServer', 'tools', 'systemPrompt']`。
- **Config 用 schemastery schema**：`export interface Config {...}` + `export const Config: z<Config> = z.object({...})`
  + 默认值。**部署可调项必须是 Config 字段**（可从 cordis.yml / 设置页改），不要硬编码常量。
- **无配置也要能加载**：聚合包 insert 行不带 `config`，loader 调 `apply` 前会用 schema
  默认值填充。`apply` 不要无条件做加载时校验——只有组合条目真的配置了关键字段才在校验，
  否则**调用时**提示「未配置」（参照 `packages/dsh-tool-describe-image` 的
  `if (config.baseURL !== undefined || config.model !== undefined) resolveConfig(config)`）。
- **所有注册放 `ctx.effect` 可逆效果里**，命名标签（`'dsh-ssh: routes'`）；settings
  变更需要热生效时，用「一个 disposer 先拆旧再装新」的 sync 模式（参照 dsh-ssh `apply`）。
- **系统提示词播报**：`ctx.systemPrompt.section({ name: 'plugin:<name>', order: <数字>, text })`
  向每个 agent 宣告插件存在、能力与限制（限制必须写：如「执行消耗 API 额度」「定时在
  浏览器端，标签页需打开」）。模型可见即日志可重建。
- 工具面：`ctx.tools.register(defineTool({ name, description, parameters, execute, presentCall }))`，
  每个工具注册返回 disposer。

## 4. client 半区（src/client/）

- `inject` 按需声明：`['slots', 'sessions', 'workspaces', 'connection', 'settingsScope', 'locale', 'remote']`。
- **槽位与 locale 用 declaration merging**：`declare module '@deepseek-ai/dsh-client-ui-slots'`
  补 `SlotMap` 槽位与 `LocaleNamespaceMap`；官方 SDK 未发布的槽位用本地 augmentation
  补齐（参照 `packages/dsh-git-graph/src/client/slots-augment.ts`）。
- 文案 i18n：`zh` 字典为 key 源、`en` 键集完整对照，`ctx.locale.register(NS, { zh, en })`。
- **纯度门（构建期强制）**：`@deepseek-ai/*` 只能 **type-only** 导入；值导入只允许平台
  种子表成员（`react` / `cordis` / `ui-slots` / `web-react` / `ui-primitives` /
  `schema-form`，见 `shared/web-platform.ts`）。跨插件协作走 cordis 服务或 slot。
- **apply 不得抛错**：Web shell 在插件 apply 抛错时整个 boot 失败。DOM 挂载失败一律
  `console.error` 后降级；用模块级 apply-guard 防重复 apply（双注入/HMR 会二次执行），
  `ctx.effect(() => releaseClaim, '...')` 在卸载时释放（参照 task-board `apply-guard.ts`）。
- DOM 注入要**自愈**：侧边栏入口用 MutationObserver 在 shell re-render 后重插
  （参照 task-board `sidebar-entry.ts`）；中栏面板与兄弟插件互斥用
  `data-dsh-*-active` 属性 + 面板激活事件。

## 5. 设置卡（全家桶标准，不许跳过）

每个功能插件都要在设置页「插件配置 → Web UI 插件」组里有一张卡（启用开关 + 配置表单）。
**「demo 不需要设置卡」不是理由**——没有卡，用户无法在设置页关掉你的插件。两步：
1. **host 半区**：`installSettingsSection(ctx, settingsNamespace('<ns>'), <z-schema>, <composition entry>, { setSource, onChange })`
   （`@deepseek-ai/dsh-settings`）注册命名空间；`onChange` 让已派生的行为跟随修改，无需重启。
2. **browser 半区**：注入 `settingsScope`，`const binder = ctx.get('webUiSettings') ?? ctx.settingsScope`
   兼容降级；`ctx.slots.inject('web-ui.plugin.item', () => ctx.slots.register({ name: 'web-ui.plugin.item', id: '<name>', order: 100+, locale: NS, inject }, <Card />))`
   注册卡片（自行 `declare module` 声明该槽，shape 与 `ui-plugin-config` 一致；order 用
   100+ 避开内置卡片）。样板见 `packages/dsh-remote-web-ui/src/client/settings-form.ts`。

## 6. 构建

```sh
pnpm --filter @linxin666/dsh-client-ui-<name> build   # 或根目录 pnpm build
pnpm --filter @linxin666/dsh-client-ui-<name> typecheck
```

- 产物：`lib/index.js`（node 半区）+ `lib/client.js`（浏览器 bundle，闭包工厂经
  `window.__ModuleLoader__.load({id, factory})` 注册，`exports.apply` 是挂载入口）+
  `lib/types`（tsc 发射）。`dsh.bundle` / `cordis.patch.yml` / `prepare` 脚本是官方安装
  契约，别删。
- CSS Modules（`*.module.css`）经 lightningcss 编译进 bundle：类名哈希与 `\0dsh-css`
  region 注释**依赖 checkout 路径**——同一源码在不同路径构建字节不同，构建产物与
  gallery/皮肤中心资产要**同一次构建一起提交**，不要在 CI 里重建比对。
- vitest 配置：`server.deps.inline: [/@deepseek-ai\//]`（SDK 包走 vite 转译）；
  client 闭包工厂测试里不可直接 import——用 `vitest.setup.ts` 的最小 `__ModuleLoader__`
  stub（参照 `packages/dsh-live-stats/vitest.setup.ts`）或 `vi.mock` 替换。
- 受限沙箱（Windows 进程隔离）下 vitest 默认 `forks` pool 与 `tsc -b` 可能被 EPERM
  拦截：包级测试改用 `vitest run --pool=threads`（必要时加 preload shim），
  `docs:write-pair` 的 git hash-object 被拦时手工计算 blob hash 写入
  `README.i18n.yaml`——`docs:check` 通过即等效；全仓门禁由 CI 无沙箱执行。

## 7. 测试

- 行为变化必须带测试（`pnpm test` 全仓门禁）；纯 UI 展示层可放宽为轻量挂载断言。
- 测试文件放 `tests/`，不得依赖 DSH 源码 checkout 的 fixture。
- 逻辑与框架解耦：核心逻辑进 `src/core/` 的结构接口注入（参照 task-board 的
  controller/execution/scheduler——测试直接驱动 tick，无定时器）。

## 8. 注册进聚合包

```sh
# packages/dsh-web-ui-all/aggregate.yml：patchFrom 与 deps 各追加一行
#   - ../dsh-<name>
node scripts/aggregate.mjs          # 重新生成聚合 cordis.patch.yml + package.json
node scripts/aggregate.mjs --check  # CI 门禁：漂移即退出 1
```

- 聚合行不带 `config`；`patchFrom` 汇总 insert 行，`deps` 解析为 `workspace:*` 依赖。
- 同步 `docs/publish-prep.md` 的包清单表。
- **移除包时注意**：`aggregate.mjs` 会保留清单之外的历史依赖（只增不删）——从
  aggregate.yml 删除后，还要手工删 `packages/dsh-web-ui-all/package.json` 里对应的
  依赖行（--check 不会报这个）。

## 9. 本地挂载验证（验收的一部分，不许跳过）

```sh
node scripts/link-profile.mjs       # 把全家桶全部包链接进 web profile（幂等）
dsh plugin --profile web add link:<仓库绝对路径>/packages/<name>
dsh web                             # 重启后侧边栏出现入口
```

- 单包调试也可先只装一个包验证。**「宿主已挂载但 UI 不显示」** = profile 目录不是
  pnpm workspace，聚合包的 `workspace:*` 回退拉取了 npm 旧版本（如历史坏包）——重跑
  `link-profile.mjs` 让子包走本地代码。
- 环境无法起 GUI 时，必须把验证步骤与预期结果写进交付说明，不得只丢一句「重启即可」。
- **重启约定（硬性约定）**：`dsh web` 正在服务当前会话时，**禁止结束该进程或占用
  它正在监听的端口**。需要重启验证挂载时，在当前会话端口之外另起测试实例，例如会话
  在 3080 就用 `dsh web --port 3090` 验证；测试实例确认无误后，是否重启主实例由
  用户决定，agent 不得自行 kill/重启正在服务当前会话的实例。
- **测试实例生命周期（硬性约定）**：验证完毕后 **agent 必须自动关闭测试实例**——
  结束自己启动的 `dsh web --port <测试端口>` 进程并确认端口已释放，不留残留进程；
  关闭后向用户报告验证结论与测试端口，主实例是否重启仍由用户决定。

## 10. 提交前门禁（至少跑这些）

```sh
pnpm typecheck
pnpm test                 # 或 pnpm --filter <pkg> test
pnpm docs:check           # README 三件套 / 链接 / 词数预算
node scripts/aggregate.mjs --check
```

改动涉及共享运行时模块（`shared/`）时：改源后跑 `node scripts/sync-shared.mjs` 并把
生成的同步副本一并提交（`test:scripts` 有 drift 门禁）。提交信息用 Conventional
Commits（`feat(<scope>): ...`），禁 emoji。

## 常见坑（借口 → 现实）

| 借口 | 现实 |
| --- | --- |
| 「设置卡不是 demo 必需」 | 全家桶每个功能插件都必须有 `web-ui.plugin.item` 卡（设置页开关），跳过即功能不完整 |
| 「模板生成的 package.json 不用动」 | `private: true` 会让发布管线跳过该包，聚合依赖在别的机器解析失败；license 必须 Apache-2.0 并有 LICENSE 文件 |
| 「构建、测试过了就行」 | 本地挂载验证（link-profile + dsh web）是验收的一部分；宿主挂载 ≠ UI 显示 |
| 「client 里 import 兄弟插件的代码很方便」 | 纯度门构建报错：跨插件值导入会内联重复运行时实例；协作走 cordis 服务 / slot |
| 「apply 抛错让上层兜底」 | client apply 抛错 = 整个 GUI boot 失败；DOM 失败 log 降级 |
| 「配置缺省无所谓」 | 组合条目无 config 时 loader 填 schema 默认值；关键字段未配置要在调用时报「未配置」，不是加载时报错 |
| 「emoji 只是文案小事」 | 全仓禁 emoji（CI 强制，含提交信息与 tag）；连 vitest 勾号（U+2713）都可能误报 |
| 「把预设复制进包内改改更快」 | 共享预设 `shared/tsdown.client.ts` 是唯一事实源，包内复制会被评审拒绝 |
| 「tsconfig 指向源码 checkout 拿类型」 | 禁止：类型只来自 node_modules 的官方 SDK；克隆后应无需任何 checkout 即可构建 |
| 「杀 3080 重启 dsh web 验证挂载」 | 当前会话正跑在 3080，杀它即断会话；按重启约定另起 `dsh web --port 3090` 测试实例验证，主实例由用户决定是否重启 |
| 「测试实例验证完就放着，下次还能用」 | 测试实例是 agent 自己起的，验证完毕必须自动关闭并确认端口释放；留着只会占端口、留残留进程 |
