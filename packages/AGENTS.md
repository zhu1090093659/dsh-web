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
- **行 id 属于 loader 的全局 id 空间**：同一 id 只挂载一个插件，后来者胜且**不报错**；官方
  bundle（`@deepseek-ai/dsh-base` / `dsh-web-app` 等）已占用其中一批 id，独立包不得复用，
  重叠会让官方行被静默丢弃、其宿主 UI 一并消失
  （[#1794](https://github.com/zhu1090093659/dsh-web/issues/1794)）。行的 `name` 必须恰好等于
  包名：官方 `dsh-client-modules` 只把浏览器半区挂在说明符等于包名的那一行上（聚合家族行的
  子路径 `name` 只挂 host 半区）。独立行改名时聚合行 id 与家族子路径不得跟着动，用聚合清单的
  `familyIds:` 映射解耦（见 [dsh-web-all/AGENTS.md](dsh-web-all/AGENTS.md)）。官方行 id 名册快照
  与该包现状由 `packages/dsh-plugin-manager/tests/bundle-row-id.spec.ts` 固定，升级 SDK cohort
  时比对该文件头刷新。
- **host / client 半区分层**：`src/index.ts` 是 host 半区（运行在 dsh host 进程），
  `src/client/` 是 browser 半区（Web GUI 侧），`src/core/` 是两侧共享的纯逻辑
  （两侧 program 都编译）。新增源码文件必须落在三个区之一。
- **exports 约定**：包内 `exports` 提供 `.`（host）与 `./client`（浏览器半区）；
  `./src/*` 用于测试引用。UI 类包按惯例 `@linxin666/dsh-client-ui-*` 命名。

## SDK 与构建约束

- **只基于官方 NPM SDK**：类型来自 `@deepseek-ai/*` devDependencies（node_modules
  解析）；peerDependencies 声明运行时注入的服务，其中宿主本体固定声明
  `"@deepseek-ai/dsh": ">=<cohort>"`，与 `dsh.engines.dsh` 下限同源、随 cohort 同步
  （门禁 `scripts/family-dsh-engines.test.mjs`）；禁止 tsconfig 指向任何 DSH 源码
  checkout。
- **宿主核包不进 `dependencies`**：`@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` 只写
  `devDependencies`（类型与 host 半区的值导入），运行时那一份一律由宿主提供。插件管理器
  会把这个段装进用户 profile，且 profile 副本优先于宿主加载，于是预发布范围就成了用户没
  点过的版本开关：`^0.2.1-rc.3` 等于 `>=0.2.1-rc.3 <0.3.0-0`，下一个 rc 照样满足，
  宿主 0.2.1-rc.3 上装进 rc.4 会让 `sessionProjections` 注册失败、`agent-loop` 无法激活
  并拖垮整套插件（[#1966](https://github.com/zhu1090093659/dsh-web/issues/1966)，门禁
  `scripts/family-host-dependencies.test.mjs`）。`@deepseek-ai/schemastery` /
  `@deepseek-ai/cordis` 是普通库，不受此限。
- **共享构建预设**：所有 tsdown 包 import `shared/tsdown.client.ts`，禁止复制到
  包内；tsconfig 分层（solution + host/client 各自 program，参照
  `dsh-git-graph`/`dsh-task-board`）。
- **运行时共享模块**：settings 卡三件套、dsh-home、mount-once、http、loopback、
  pair-access、telemetry、tool-surface 等家族共享模块的事实源在 `shared/`
  （权威清单是 `scripts/sync-shared.mjs` 的 manifest），包内同名文件是生成的同步副本
  （generated 头注释，禁止手改；改 shared 源后重跑同步，test:scripts 含 drift 门禁）。
  只被一个包使用的模块归该包所有，不进 `shared/`。
- **浏览器 bundle 纯度门**：`@deepseek-ai/*` 的值导入仅允许
  [平台种子表](../shared/web-platform.ts)成员，其余只能 type-only 导入。
  跨插件协作走 cordis 服务
  （`ctx.slots` / `ctx.sessions` / `ctx.workspaces`）或 slot，不走 value import。
- **样式**：CSS Modules（`*.module.css`）经 lightningcss 编译进 bundle；不引入
  UI 框架样式库。填充主按钮一律用主按钮三件套
  （`--dsw-alias-button-primary-fill` / `--dsw-alias-button-primary-hover` /
  `--dsw-alias-label-primary-foreground`，明暗两组），不得把
  `--dsw-alias-brand-primary` 当填充色（官方主题下它与前景同值，会出现
  黑底黑字/白底白字），契约见
  [primary-action-tokens-v1.md](https://github.com/zhu1090093659/dsh-skins/blob/main/contracts/primary-action-tokens-v1.md)（契约随皮肤中心迁至 dsh-skins 仓）。

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
- 例外：dsh-desktop-launcher（桌面启动器）已彻底移除——包、聚合行、设置桥白名单、
  远程通道本地面、ru 语言包与文档引用均已清理；桌面启动场景由官方 DeepSeek
  Harness 桌面客户端承接。
- 例外：dsh-model-capabilities（模型能力配置）已彻底移除——包、聚合行、ru 语言包
  与文档引用均已清理；自定义模型的输入类型与推理档位由官方 Models 设置页编辑。

## 语义属性约定（L2，issue #506）

- 插件根容器与关键部件必须输出语义属性：根容器打 `data-dsh-plugin="<插件短名>"`，
  部件打裸值 `data-dsh-part`（归属交给 plugin 属性，如 `column` 而非
  `task-board-column`）；枚举、owner 与锚定方式见
  [semantic-attrs-v1.md](https://github.com/zhu1090093659/dsh-skins/blob/main/contracts/semantic-attrs-v1.md)（契约随皮肤中心迁至 dsh-skins 仓）。
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

- **插件页展示元数据**：包根 `locale/en.json` 与 `locale/zh.json` 承载官方插件列表的行标题与
  灰色描述（`meta.title` / `meta.description`），两者必须在 `exports` 里各有一条
  `./locale/<lang>.json` 键并进 `files` 白名单：宿主按 `en` 起步解析、再枚举该目录逐个文件
  走 exports，盘上的文件集合与 exports 键必须一一对应，多一个或少一个都会让整条元数据报错。
  中文标题写产品名、中文描述不超过 20 个汉字；包级此通道只随 `zh` + `en`（缺 ru 时宿主回落
  `en`），聚合家族行的 ru 文案由 dsh-web-all 单独维护。`icon.svg` + 顶层 `icon` 是同一页的
  卡片图标，与本组元数据同批落齐。

## 安全语义

- 涉及密钥 / 凭据 / 远程执行 / 令牌撤销的包（如 `dsh-ssh`、`dsh-remote-bridge`）
  修改安全语义时必须同步更新 README 与测试；安全模型说明放包 README 的
  `## 安全模型` 一节。

## 包级 AGENTS.md

- 包有跨目录规则、复杂构建链或安全模型时，在该包写 `AGENTS.md`（参照
  `dsh-git-graph/AGENTS.md`、`dsh-ssh/AGENTS.md` 的简洁风格）。
- 包级 AGENTS.md 只写该包特有规则，不重复本文件与根文件内容。
