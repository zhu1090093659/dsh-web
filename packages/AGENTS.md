# AGENTS.md — 包级规则（packages/）

本层规则补充根 [AGENTS.md](../AGENTS.md) 的全局约定，适用于 `packages/` 下所有
插件包与皮肤包。新建或修改包前先读本文件；包特有规则写在该包自己的
`AGENTS.md`。

## 包形态

- **独立 cordis bundle 包**：`"type": "module"`，node `^22.19 || >=24`，
  `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` 声明 bundle 激活；
  `dsh.client` 声明浏览器半区注入与 `platform: "web"`（形态参照
  `packages/dsh-task-board/`）。
- **聚合包 id 命名空间**：聚合生成器把子插件行 id 统一改为 `web-ui-*`（剥掉子包 `ui-` 前缀），
  与独立包安装共存，不再触发 loader 的 duplicate entry id；生成文件勿手改。host 半区经
  `shared/host/mount-once.ts`（sync-shared 同步副本）防重：同一插件双源加载时只注册一次，
  第二个来源为空操作，浏览器半区由官方 client 模块系统按包名去重。
- **host / client 半区分层**：`src/index.ts` 是 host 半区（运行在 dsh host 进程），
  `src/client/` 是 browser 半区（Web GUI 侧），`src/core/` 是两侧共享的纯逻辑
  （两侧 program 都编译）。新增源码文件必须落在三个区之一。
- **exports 约定**：包内 `exports` 提供 `.`（host）、`./client`（浏览器半区）、
  必要时 `./invariant`；`./src/*` 用于测试引用。UI 类包按惯例
  `@linxin666/dsh-client-ui-*` 命名。

## SDK 与构建约束

- **只基于官方 NPM SDK**：类型来自 `@deepseek-ai/*` devDependencies（node_modules
  解析）；peerDependencies 声明运行时注入的服务；禁止 tsconfig 指向任何 DSH 源码
  checkout。
- **共享构建预设**：所有 tsdown 包 import `shared/tsdown.client.ts`，禁止复制到
  包内；tsconfig 分层（solution + host/client 各自 program，参照
  `dsh-git-graph`/`dsh-aionui-panel`）。
- **运行时共享模块**：settings 卡三件套、poll-guard、dsh-home 的事实源在
  `shared/`，包内同名文件是 `scripts/sync-shared.mjs` 生成的同步副本
  （generated 头注释，禁止手改；改 shared 源后重跑同步，test:scripts 含 drift 门禁）。
- **浏览器 bundle 纯度门**：`@deepseek-ai/*` 只能 type-only 导入；值导入只允许
  平台种子表成员（react / cordis / ui-slots / web-react / ui-primitives /
  schema-form，见 `shared/web-platform.ts`）。跨插件协作走 cordis 服务
  （`ctx.slots` / `ctx.sessions` / `ctx.workspaces`）或 slot，不走 value import。
- **样式**：CSS Modules（`*.module.css`）经 lightningcss 编译进 bundle；不引入
  UI 框架样式库。

## 测试纪律

- 每个包必须有 `vitest run` 可通过的测试（`pnpm test` 全仓门禁）。行为变化必须
  带测试；纯 UI 展示层的冒烟测试可放宽为轻量挂载断言。
- `tests/` 放测试，测试文件不得依赖 DSH 源码 checkout 的 fixture。
- 聚合载具包（dsh-web-ui-all / dsh-skins）可无单测，但聚合生成脚本必须有
  `--check` 一致性门禁（`aggregate.mjs` / `build.mjs` 的 check 模式）。
- 例外：dsh-aionui-panel 已停止支持——不再保留测试、typecheck 门禁与 e2e 断言
  （右侧面板由 dsh-better-sidebar 接管），后续版本将从聚合包移除。

## 双语纪律

- 主插件包 README 中英配对：`README.md`（英文）+ `README.zh.md`（中文）+
  `README.i18n.yaml`（配对一致性记录）；皮肤包同样双语。规则见
  [docs/AGENTS.md](../docs/AGENTS.md) 与 [docs/i18n.md](../docs/i18n.md)。
- 包内 UI 文案 i18n：`zh` 字典为 key 源，`en` 键集完整对照，经
  `ctx.locale.register` 注册；错误文案与官方 DSH 词汇对照。

## 安全语义

- 涉及密钥 / 凭据 / 远程执行 / 令牌撤销的包（如 `dsh-ssh`、`dsh-remote-web-ui`）
  修改安全语义时必须同步更新 README 与测试；安全模型说明放包 README 的
  `## 安全模型` 一节。

## 包级 AGENTS.md

- 包有跨目录规则、复杂构建链或安全模型时，在该包写 `AGENTS.md`（参照
  `dsh-git-graph/AGENTS.md`、`dsh-remote-web-ui/AGENTS.md` 的简洁风格）。
- 包级 AGENTS.md 只写该包特有规则，不重复本文件与根文件内容。