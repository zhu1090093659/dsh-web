# dsh-web-ui — 仓库规则

DeepSeek Harness Web GUI 的插件与皮肤全家桶 monorepo。每个插件都是独立的
cordis bundle 包，经 `cordis.patch.yml` + profile 机制挂载到 `dsh web`，绝不修改
DSH 源码。改 `packages/` 前先读 [packages/AGENTS.md](packages/AGENTS.md)；写文档
先读 [docs/AGENTS.md](docs/AGENTS.md)。

## 仓库布局

```text
packages/
  dsh-<plugin>/       功能插件包（task-board / git-graph / ssh / pet /
                      aionui-panel（已停止支持）/ remote-web-ui / web-ui-settings / community-plugins）
  skins/skin-center/  皮肤中心包（顶层设置卡；skins/<id>/ 纯资产目录内置全部皮肤，
                      是本仓唯一皮肤事实源与唯一加载器）
  dsh-skins/          已退役兼容载具（保留一个发布周期）：只依赖 skin-center，不带皮肤资产
  dsh-web-ui-all/     全家桶聚合包：aggregate.yml 汇总全部功能插件 + 外部右侧栏插件
                      dsh-better-sidebar（rows 节）
shared/
  tsdown.client.ts    唯一共享构建预设（禁止在包内复制）
  web-platform.ts     客户端平台种子表（浏览器 bundle 纯度门）
  host/client/        跨包运行时模块唯一事实源；包内同名文件是 sync-shared.mjs 生成的同步副本（禁手改）
scripts/              仓库维护脚本（聚合生成 / 链接 / 皮肤脚手架 / 校验）
docs/                 长期文档与归档（见 docs/AGENTS.md）
gallery/              皮肤画廊静态站（CI 校验与部署）
```

## 常用命令

```sh
pnpm install              # 安装依赖（NPM_TOKEN 见 docs/plugins.md 环境说明）
pnpm build                # 全仓构建（pnpm -r build）
pnpm test                 # 全仓单测
pnpm typecheck            # 全仓类型检查
pnpm test:scripts         # scripts/ 下 *.test.mjs 测试
pnpm aggregate:check      # 聚合包一致性（CI 门禁）
pnpm gallery:check        # 画廊产物一致性（CI 门禁）
pnpm skin-center:check    # 皮肤中心注册表一致性（CI 门禁）
pnpm docs:check           # 文档一致性（链接 / README / i18n 配对，CI 门禁）
node scripts/dsh-plugin-new <name>   # 脚手架：新插件包
node scripts/dsh-skin-new            # 脚手架：新皮肤资产目录
```

改动提交前至少跑一遍 `pnpm typecheck && pnpm test && pnpm docs:check`（CI 会全量
跑所有门禁，见 [docs/development.md](docs/development.md)）。

## 全局约定

- **禁止修改 DSH 源码**：挂载只走 `cordis.patch.yml` + profile；tsconfig
  `extends` / `paths` / `references` 不得指向任何 DSH 源码 checkout；类型只来自
  `@deepseek-ai/*` 官方 NPM SDK（node_modules 解析），详见
  [packages/AGENTS.md](packages/AGENTS.md)。
- **新包一律 `dsh-` 前缀**；npm 包名 `@linxin666/dsh-*`（UI 类插件按惯例
  `@linxin666/dsh-client-ui-*`）。
- **构建预设只用 `shared/tsdown.client.ts`**，禁止在包内复制。
- **禁止使用 emoji**（含 Emoji_Presentation、U+FE0F、ZWJ、区域指示符、Dingbats 等
  Unicode Emoji 属性字符），覆盖代码、注释、文档、UI 文案、脚本输出与提交信息；
  需要装饰时用普通字符（`×`、`-`、`*`）或省略。CI 有全树检查。
- **认证环境**：`NPM_TOKEN` 只放环境变量；token 配置放用户级 `~/.npmrc`，
  项目 `.npmrc` 只留 scope 映射（详见 docs/plugins.md）。
- **双语纪律**：主插件包 README 中英配对（`README.md` + `README.zh.md` +
  `README.i18n.yaml`），皮肤资产目录 README 双语，规则见
  [docs/AGENTS.md](docs/AGENTS.md) 与 [docs/i18n.md](docs/i18n.md)。
- **文档随代码更新**：任何改动若触及 README / AGENTS.md / docs/ 描述的行为，
  必须同 PR 更新文档，否则 `pnpm docs:check` 变红。
- **一次性记录不进长期文档**：任务交接、验证快照归档到
  [docs/archive/](docs/archive/)，不混入长期文档目录。

## 开发与贡献流程

所有代码改动（本地开发与远程 PR）必须遵循本流程。贡献者入口文档：
[CONTRIBUTING.md](CONTRIBUTING.md)；日常开发细节见 [docs/development.md](docs/development.md)。

### 分支模型

- `dev` 是开发分支（集成分支）：本地开发与远程 PR 统一合并到 `dev`，
  提交前先 `git fetch origin && git rebase origin/dev` 同步。
- `main` 是稳定分支：只接收 `dev` 上测试通过后合入的代码（由维护者执行）。

### 提交规范（Conventional Commits）

提交信息格式 `type(scope): subject`，type 用 `feat` / `fix` / `chore` / `docs` /
`test` / `refactor` / `perf`，scope 是包名或主题（如 `ssh`、`task-board`、`skins`、
`readme`、`release`），关联 issue 时 subject 末尾追加 `(#123)`。例：
`fix(task-board,ssh): hide composer under active panel (#76 #87)`。提交信息与
代码、注释、文档一样禁止 emoji。

### 提交前必过门禁

`pnpm typecheck` / `pnpm test` / `pnpm test:scripts` / `pnpm docs:check`
（涉及聚合包、画廊、皮肤中心时另跑 aggregate/gallery/skin-center 三个
--check）。CI（.github/workflows/ci.yml）全量执行所有门禁，红则 PR 不合并。

### PR 要求（本地与远程一致）

- 一律以 `dev` 为 base 提 PR；按 [PR 模板](.github/pull_request_template.md)
  填写（摘要、涉及包、类型、最新代码确认、测试证据与上游同步、AI 编码披露、
  仓库规范检查、本地验证；用户可见变更附证据）。
- **测试证据必填**：贡献者 PR 必须提供自己本地测试的证据，并附上同步上游
  最新 `dev` 分支后重新测试通过的证据（CI 与 scripts/pr-review.mjs 双重
  拦截）。文本类改动可不附截图；视觉修复 / 用户可见变更必须附截图（视觉
  修复需完成态或修复前后对比），且视觉修复必须用支持图像输入的多模态
  模型完成——纯文本模型（如 deepseek-chat / deepseek-reasoner / gpt-3.5）
  修复的视觉类 PR 不接受。
- 改包 README 必须同 PR 维护中英三件套并 `pnpm docs:write-pair` 重录配对；
  任一侧不同步另一侧 `docs:check` 即红。
- 新增/删除包、改皮肤清单时同步 `docs/publish-prep.md` 与
  `packages/dsh-web-ui-all/aggregate.yml`（`node scripts/aggregate.mjs` 重生成）。
- 一次性记录（任务交接、验证快照）进 `docs/archive/`。

### 发布纪律（维护者）

发布由 tag 触发（`.github/workflows/release.yml`）：推送 `vX.Y.Z` 后
`scripts/verify-version.mjs` 校验每个包版本与 tag 一致，不一致则发布前失败；
Release 更新说明由 `scripts/release-notes.mjs` 从常规提交自动分组生成；
全部门禁重跑通过后才发 npm。不要直接改包版本号绕过 tag 校验。

## 分层指令体系（渐进式上下文）

| 文件 | 作用 |
| --- | --- |
| 本文件（根 AGENTS.md） | 仓库布局、命令、全局规则，每个会话都需要 |
| [.agents/skills/dsh-web-ui-agent-coding/SKILL.md](.agents/skills/dsh-web-ui-agent-coding/SKILL.md) | 项目 Agent Coding 工作流；按任务加载同目录下的开发、审查、文档、验证或 GUI 验收技能 |
| [packages/AGENTS.md](packages/AGENTS.md) | 包级规则：SDK 约束、bundle 形态、测试纪律 |
| [docs/AGENTS.md](docs/AGENTS.md) | 文档标准：结构分层、写作规则、i18n 配对 |
| 各包 `AGENTS.md` | 该包特有规则（如 dsh-ssh 安全模型、dsh-skins 退役载具形态） |

## 编辑这些指令

规则只在其归属层写一次，其他层引用链接，不重复展开。保持每条规则自包含（1-3
行），细节链接到归属文档。精简优于扩充。