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
  `dsh-git-graph`/`dsh-task-board`）。
- **运行时共享模块**：settings 卡三件套、poll-guard、dsh-home 的事实源在
  `shared/`，包内同名文件是 `scripts/sync-shared.mjs` 生成的同步副本
  （generated 头注释，禁止手改；改 shared 源后重跑同步，test:scripts 含 drift 门禁）。
- **浏览器 bundle 纯度门**：`@deepseek-ai/*` 只能 type-only 导入；值导入只允许
  平台种子表成员（react / cordis / ui-slots / ui-primitives，见
  `shared/web-platform.ts`）。跨插件协作走 cordis 服务
  （`ctx.slots` / `ctx.sessions` / `ctx.workspaces`）或 slot，不走 value import。
- **样式**：CSS Modules（`*.module.css`）经 lightningcss 编译进 bundle；不引入
  UI 框架样式库。填充主按钮一律用主按钮三件套
  （`--dsw-alias-button-primary-fill` / `--dsw-alias-button-primary-hover` /
  `--dsw-alias-label-primary-foreground`，明暗两组），不得把
  `--dsw-alias-brand-primary` 当填充色（官方主题下它与前景同值，会出现
  黑底黑字/白底白字），契约见
  [skins/skin-center/contracts/primary-action-tokens-v1.md](skins/skin-center/contracts/primary-action-tokens-v1.md)。

## Agent 公告约定（issue #839）

- 会向 agent 系统提示注入公告（systemPrompt section）的插件必须提供
  `announceToAgent` 开关：schema 默认 `false`（默认不注入，保持系统提示词干净），
  用户在设置界面（或 profile patch）按需开启；开关必须经
  `installSettingsSection`（或等价的自定义设置卡）暴露到 Web 设置界面并即时生效。
- 公告文本只陈述能力、约束与触发词，不包含与当前任务无关的长段声明。

## 测试纪律

- 每个包必须有 `vitest run` 可通过的测试（`pnpm test` 全仓门禁）。行为变化必须
  带测试；纯 UI 展示层的冒烟测试可放宽为轻量挂载断言。
- `tests/` 放测试，测试文件不得依赖 DSH 源码 checkout 的 fixture。
- 聚合载具包（dsh-web-all）可无单测，但聚合生成脚本必须有
  `--check` 一致性门禁（`aggregate.mjs` 的 check 模式）。
- 例外：dsh-aionui-panel（旧右侧面板）已彻底移除——包、聚合行、内嵌设置卡与文档
  引用均已清理；右侧面板由 dsh-better-sidebar 提供（聊天区 mermaid 出图与
  composer 拖文件插入随包移除，官方管线无对应能力）。
- 例外：dsh-live-stats（实时令牌估算）已彻底移除——包、测试、门禁与文档引用
  均已清理，不再支持。

## 语义属性约定（L2，issue #506）

- 插件根容器与关键部件必须输出语义属性：根容器打 `data-dsh-plugin="<插件短名>"`，
  部件打裸值 `data-dsh-part`（归属交给 plugin 属性，如 `column` 而非
  `task-board-column`）；枚举、owner 与锚定方式见
  [skins/skin-center/contracts/semantic-attrs-v1.md](skins/skin-center/contracts/semantic-attrs-v1.md)。
- 新增/修改枚举值必须与该契约表同 PR 更新；每个值要有 owner、含义与锚定方式，
  不得只堆字符串。
- 不输出语义属性的插件只享受 L1 token 基础换肤覆盖，不承诺完整覆盖。
- 不复用官方 `data-plugin`（它标注 style 标签归属，语义不同）；body/html 级
  属性不属于 surface/part/plugin 枚举。

## 双语纪律

- 主插件包 README 中英配对：`README.md`（英文）+ `README.zh.md`（中文）+
  `README.i18n.yaml`（配对一致性记录）；皮肤包同样双语。规则见
  [docs/AGENTS.md](../docs/AGENTS.md) 与 [docs/i18n.md](../docs/i18n.md)。
- 包内 UI 文案 i18n：`zh` 字典为 key 源，`en` 键集完整对照，经
  `ctx.locale.register` 注册；错误文案与官方 DSH 词汇对照。第三语言 ru 由
  [dsh-i18n](dsh-i18n/AGENTS.md) 集中承载：各包新增/修改 zh 键后必须同步补
  ru 并通过 `pnpm i18n:check`（缺键、占位符不一致即红），包内不自带 ru 字典。

## 安全语义

- 涉及密钥 / 凭据 / 远程执行 / 令牌撤销的包（如 `dsh-ssh`、`dsh-remote-web-ui`）
  修改安全语义时必须同步更新 README 与测试；安全模型说明放包 README 的
  `## 安全模型` 一节。

## 包级 AGENTS.md

- 包有跨目录规则、复杂构建链或安全模型时，在该包写 `AGENTS.md`（参照
  `dsh-git-graph/AGENTS.md`、`dsh-remote-web-ui/AGENTS.md` 的简洁风格）。
- 包级 AGENTS.md 只写该包特有规则，不重复本文件与根文件内容。