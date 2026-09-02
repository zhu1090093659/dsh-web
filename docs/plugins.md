# 如何把新插件加入全家桶

本指南说明如何把一个新插件加入 dsh-web 全家桶，使其可以被聚合插件包（`dsh-web-all`）一键装齐，也可独立安装。

## 流程

### 1. 脚手架生成

```sh
node scripts/dsh-plugin-new <name>
```

在 `packages/<name>/` 生成标准 bundle 骨架（`<name>` 限小写字母、数字、单连字符，如 `dsh-task-board`），并替换模板中的 `__NAME__` 占位。生成的结构：

```text
packages/<name>/
├── cordis.patch.yml   # 插件行（- insert: - id: ui-<name> / name: ...）
├── package.json       # dsh.bundle.patch 清单 + dsh.client 声明
├── src/
│   ├── index.ts       # host 半区（node 进程侧）
│   └── client.ts      # browser 半区（Web GUI 侧）
├── tsconfig.json
├── tsdown.config.ts
├── README.md          # 英文版（含 H1 后语言切换行）
├── README.zh.md       # 中文版（结构与英文镜像）
├── README.i18n.yaml   # 配对一致性记录（docs/i18n.md）
└── AGENTS.md          # 包级 AI 指令（可选，复杂包建议写）
```

### 2. 实现插件逻辑

- host 半区 `src/index.ts`：导出 cordis 插件，运行在 dsh host 进程（例如系统提示词公告、真实任务执行等）。
- browser 半区 `src/client.ts`：Web GUI 侧的 UI 逻辑，经 package.json 的 `dsh.client` 声明注入运行时。
- 形态参照 `packages/dsh-task-board/`：`dsh.bundle.patch` 指向包内 `cordis.patch.yml`；`dsh.client` 声明 `inject: ["@deepseek-ai/dsh-client-runtime"]` 与 `platform: "web"`。

### 3. 注册进聚合包

把 `- ../<name>` 追加到 `packages/dsh-web-all/aggregate.yml` 的 `patchFrom` 和 `deps` 两段：

- `patchFrom`：该包的 `cordis.patch.yml` insert 行会被汇总进聚合包 patch；
- `deps`：解析为包名写入聚合包 `package.json` 的 `dependencies`（`workspace:*`）。

皮肤（新增或改动）不需要进任何 aggregate.yml：皮肤是纯资产目录，仓库内位于 `packages/skins/skin-center/skins/<id>/`（市场构建与预览的共同来源）；npm 包 `files` 白名单只随发默认皮肤 `blue-fantasy`，其余皮肤由市场按需安装到 `$DSH_HOME/skins/<id>/` 后由皮肤中心管理。改完皮肤后运行 `pnpm skin-center:check` 与 `pnpm market:build` 刷新 market/dist。皮肤启用互斥由 `dsh-skin use` 管理（客户端原子切换，不改 cordis.patch.yml）。

### 4. 重新生成聚合包

```sh
node scripts/aggregate.mjs          # 重新生成聚合包 cordis.patch.yml + 依赖
聚合行 id 自动加 `web-ui-` 前缀，可与独立包共存；规则见 packages/AGENTS.md。
node scripts/aggregate.mjs --check  # 校验模式：漂移即失败（CI 用）
```

### 5. 构建验证

```sh
pnpm install   # workspace 链接（packages/* 与 packages/skins/*）
pnpm -r build  # 全仓构建
```

> **前置要求**：类型来源是官方 NPM SDK——`@deepseek-ai/*` 官方 NPM SDK 包（scope registry 为
> registry.npmjs.org），**不依赖任何 DSH 源码 checkout**。首次构建前：
> 1. 若仍使用私有 scope 认证，设置环境变量 `export NPM_TOKEN='<token>'`（真实令牌只放环境变量，勿提交）；
>    当前 SDK 已结束内测，公开包通常无需令牌即可安装；
> 2. token 放**用户级 `~/.npmrc`**（`//registry.npmjs.org/:_authToken=${NPM_TOKEN}`，由 pnpm 展开
>    环境变量）；项目 `.npmrc` 只留 scope 映射（`@deepseek-ai:registry=https://registry.npmjs.org/`，
>    已在 `.gitignore` 中）。注意：项目级 `.npmrc` 里的 `${NPM_TOKEN}` 占位符在 pnpm 11 下不会被
>    展开、被忽略，不承担认证职责；
> 3. 所有 pnpm/npm 命令必须在设置了 `NPM_TOKEN` 的环境中执行（fresh shell 需自行 export）。
> 缺失时 `pnpm install` 无法拉取私有 SDK 包，`pnpm -r build` / `pnpm typecheck` 会失败。

### 6. 本地验证

两种方式任选：

```sh
# 方式 A：用 link-profile 脚本把全家桶全部包链接进 profile（推荐；脚本自动处理 @linxin666 命名空间）
node scripts/link-profile.mjs            # 链接/刷新全家桶；--dry-run 预览

# 方式 B：只把聚合包本身注册进 profile（聚合包的 workspace:* 依赖会回退解析到 npm 已发布版本，
# 因此请先确认 npm 上的 @linxin666/dsh-* 为最新且可用，或先用方式 A 链接全部子包）
dsh plugin --profile web add link:<dsh-web>/packages/dsh-web-all
```

重启 `dsh web`，确认聚合包插件行挂载生效。调试阶段也可先单独安装单包（`link:<dsh-web>/packages/<name>`）验证。

> 注意：profile 目录不是 pnpm workspace，聚合包 package.json 里的 `workspace:*` 依赖无法就地解析，
> 会回退拉取 npm 已发布的版本——若 npm 版本滞后或损坏（如历史上的 dsh-pet 0.1.1 缺 chunk），
> 会出现「宿主已挂载但 UI 不显示」的现象。此时用 `node scripts/link-profile.mjs` 把仓库构建产物
> 链接进 `~/.dsh/profiles/node_modules/@linxin666/`，即可让全部子包走本地代码。

## 第三方插件准入原则

家族仓库欢迎社区插件，但收编必须透明：

1. **活跃且有上游的第三方 → 不搬代码**。优先 fork 到 dsh-external 组织维护（保留上游关联，可随时 merge 上游更新），或作为依赖引用；全家桶只注册其安装入口。
2. **收编条件**（无活跃上游、上游已停更、或作者明确授权组织托管）：
   - 用 `git subtree add` 迁入，保留完整 git 历史；
   - **必须**保留上游 LICENSE 文件与作者署名（包内 LICENSE、README 作者声明）；
   - 在包 README 记录来源仓库与迁移日期；
   - 版权归原作者，本仓库仅托管，不主张版权。
3. **合规红线**：无 LICENSE、作者未授权、或版权归属不明的代码，一律不收编。

### 社区插件索引登记

第三方插件作者可把自己的插件登记进创意工坊商店的插件目录（设置 → 创意工坊 → 插件）与 dsh-market.com 创意工坊站：

1. 在 `packages/dsh-community-plugins/community.json` 追加条目：`id` / `name` / `nameEn` / `author` / `repo`（https:// 仓库 URL）必填，`description` / `descriptionEn` / `npm` 可选；`category`（一级分类）与 `subcategory`（二级分类）可选，合法枚举见 `scripts/community-index` 的 `CATEGORIES` 与 `SUBCATEGORIES`，且 `subcategory` 只在 `category` 已填时被接受——分类与二级分类一同驱动创意工坊的两级筛选；
2. 运行 `node scripts/community-index` 校验数据（CI 门禁同款校验）；
3. 运行 `node scripts/market-build` 重新生成 `market/dist` 清单（`manifest/plugins.json` 由 community.json 派生）并提交生成物（`market:check` 校验一致）。

索引只收录链接、不搬代码，条目版权归原作者，由维护者审核合并。

## 插件规范要点

- **package.json 的 `dsh.bundle.patch` 声明**：指向包内 `cordis.patch.yml`，这是官方 bundle 清单，`dsh plugin` 依赖它识别与挂载插件。
- **`dsh.engines.dsh` 最低运行时声明**（issue #754）：每个发布包必须在 `dsh` 对象内声明 `"engines": { "dsh": ">=X.Y.Z[-rc.N]" }`（如 `"dsh": ">=0.1.1-rc.1"`），唯一支持形式为 `>= <semver>`（顶层 `engines.dsh` 是插件管理器兼容读取的备用位，新声明统一用 `dsh.engines.dsh`）。该字段随 npm 清单发布，插件管理器在更新检查与更新前读取并据此提示/拦截；`scripts/family-dsh-engines.test.mjs` 强制每个家族包与插件模板都声明。SDK cohort 升级时必须同步提升所有包的该字段：宿主版本门槛跟随当前适配的 cohort，根 README 徽章与 CI 挂载冒烟道使用同一版本（决策见 [dsh-host-floor-tracks-cohort](../.agents/notes/implemented/architecture/2026-09-01-dsh-host-floor-tracks-cohort.zh.md)）。
- **cordis.patch.yml insert 行格式**（包名用家族 scope `@linxin666`，与 npm 发布名一致）：

```yaml
- insert:
    - id: ui-<name>
      name: '@linxin666/dsh-client-ui-<name>'
```

- **类型来源（只能基于官方 NPM SDK）**：各包把用到的 `@deepseek-ai/*` 包声明为 `devDependencies`
  （`^0.1.0-rc.7`；cordis 用 `^4.0.1`），TS 从 node_modules 自动解析类型
  （SDK 包的 `exports["."].types` 统一指向 `lib/types/index.d.ts`，client 半区子路径
  `./client` 同理）。**禁止** tsconfig `extends` / `paths` / `references` 指向任何 DSH 源码
  checkout（历史形态：`../../../test-zhu1090093659` 相对路径、`~/.dsh/source/current` 绝对
  paths —— 均已废除）。tsconfig 为自包含单项目：`moduleResolution: "bundler"` +
  `allowImportingTsExtensions`（emit 项目另加 `rewriteRelativeImportExtensions: true`，
  参照 `packages/dsh-task-board/tsconfig.json`）。构建/类型/测试全部以 node_modules 的 SDK 包为
  唯一类型来源，克隆后无需任何源码 checkout 即可构建。
- **浏览器 client 半区**：`@deepseek-ai/*/client` 子路径由 SDK 包 exports 提供（闭包工厂产物，
  运行时经 `window.__ModuleLoader__` 加载）。官方 SDK 尚未发布的槽位（如
  `conversation.input.selector.*`）用**模块形式**的本地 augmentation 补齐类型
  （`import type {}` + `declare module '@deepseek-ai/dsh-client-ui-slots'`，参照
  `packages/dsh-git-graph/src/client/slots-augment.ts`），SDK 发布对应槽位后移除。
- **构建预设**：统一走仓库内单一共享副本 `shared/tsdown.client.ts`（平台模块表
  `shared/web-platform.ts`），各包 `tsdown.config.ts` 引用它并传参（`libExternal` /
  `companions` 等）。**禁止**再复制预设到包内。
- **测试基建**：vitest 配置需 `server.deps.inline: [/@deepseek-ai\//]`（SDK 包走 vite 转译，
  处理 CSS）；client 半区闭包工厂在测试中不可直接 import——用 `vitest.setup.ts` 的最小
  `__ModuleLoader__` stub（`packages/dsh-remote-web-ui/vitest.setup.ts`）或 `vi.mock` 替换
  （`packages/dsh-remote-web-ui/tests/remote-entry.spec.tsx` 的 `createSnapshotStore` mock）。
- **设置页插件配置（20260811+ 可选能力）**：DSH web 设置的「插件配置」区展示每插件一张卡片（`settings.plugin.item` 槽）。Web 插件组、皮肤中心、社区插件、桌面宠物各注册一级设置分区（`settings.section`，`label` 用 thunk 跟随语言，内容直接展开）；Web 插件组声明 `web-ui.plugin.item` 子槽归组 task-board 等卡片。插件接入只需两步：
  1. **host 半区**：`installSettingsSection(ctx, settingsNamespace('<ns>'), <z-schema>, <composition entry>, { setSource, onChange })`（`@deepseek-ai/dsh-settings`）注册命名空间；`setSource` 注入动态读取器，`onChange` 让已派生的行为跟随已提交的修改，无需重启。
  2. **browser 半区**：注入 `settingsScope`（`@deepseek-ai/dsh-client-ui-settings` 提供 `ctx.settingsScope`；`bind()` 还要求注入 `connection` 与 `remote`），`ctx.settingsScope.bind({ namespace })` 读写该命名空间，并注册卡片：归组用 `web-ui.plugin.item`，插件配置页用 `settings.plugin.item`，一级菜单用 `settings.section`（自行 `declare module '@deepseek-ai/dsh-client-ui-slots'` 声明该槽，shape 与官方一致；`order` 用 100+；一级分区卡片加 `alwaysOpen` 直接展开）。样板见 `packages/dsh-remote-web-ui`（自包含 staged 表单，不依赖兄弟 UI 包）。
- **皮肤类插件**：改用 `scripts/dsh-skin-new` 脚手架（皮肤规范见 skin-center / 各皮肤包 README），不经过本流程第 3-4 步的 `dsh-web-all` 注册。皮肤中心（skin-center）虽是皮肤聚合，其 GUI 是一级设置分区（设置 → 皮肤中心），自带启用开关。## 移植 harness 插件的挂载约束

聚合包 insert 行不带 `config`，loader 调 `apply` 前会用插件 schema 默认值填充配置；`apply` 若无条件加载时校验会把填充后的空配置当配置而抛错，profile 加载失败。应改为：组合条目配置了关键字段才在加载时校验，否则调用时提示「未配置」（settings section 提交仍严格校验）。参考 `packages/dsh-tool-describe-image`。
