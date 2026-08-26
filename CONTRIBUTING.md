# 贡献指南（Contributing）

欢迎为 dsh-web（DSH Web GUI 插件与皮肤全家桶）贡献代码。本文件是贡献者的
入口；仓库的全部规则与机制以 [AGENTS.md](AGENTS.md)（及其分层指令）为准，
冲突时以 AGENTS.md 为准。

## 分支与合入流程

- `dev` 是开发分支（集成分支）：本地开发与远程 PR 统一以 `dev` 为
  目标分支；`dev` 上测试通过后，由维护者合入 `main`。
- PR 打开后由 `.github/workflows/auto-assign-pr-reviewers.yml` 按 PR 描述中
  勾选的「PR 类别」自动分派：把对应协作者设为负责人并请求其审查（渲染器 /
  Wallpaper Engine / WebGL 相关 PR 由 Aa728848 负责并审查），路由规则见
  [PR_TRIAGE.md](PR_TRIAGE.md)。
- 合并门禁：`dev` / `main` 要求 3 个必需检查全绿，**不要求人工审批**；
  具有 write 权限的协作者检查通过后即可自行合并（含自己的 PR），无需等待
  维护者审批。
- `main` 是稳定分支：只接收从 `dev` 合入且测试通过的代码。
- 提 PR 一律以 `dev` 为 base，不要以 `main` 为 base。

## PR 范围：只接受三类内容贡献

本仓库对外部贡献者**只接受**以下三类 PR：

- **插件申请（社区插件索引登记）**：第三方插件由作者在自己的仓库按官方
  cordis bundle 标准实现，向本仓库申请登记进社区插件索引——在
  `packages/dsh-community-plugins/community.json` 追加条目并重新生成
  注册表，随 PR 提交；
- **皮肤增加（新皮肤收录）**：新皮肤作为纯资产收录进皮肤中心
  （`packages/skins/skin-center/skins/<id>/`），收录到我们部署的
  dsh-market.com 服务器（Workshop 商店）供用户按需安装——**默认安装不带**：
  skin-center npm 包只随附 `blue-fantasy`，新皮肤由用户经 Workshop
  按需安装到 `$DSH_HOME/skins/<id>/`。**低质皮肤 PR 不予接受**（没有
  背景图、仅简单改色且样式存在明显问题，如暗色缺失、对比度不足、布局
  错位），请完善样式并附亮 / 暗试穿截图后再提交；
- **宠物增加（新宠物收录）**：按宠物契约新增
  `packages/dsh-pet/assets/<id>/`（`pet.json` manifest + 图集，可选
  语音包 / 预览 / 装饰），随 PR 收录为内置宠物。

除上述三类外的所有改动（bug 修复、功能增强、全新功能、文档、测试、
维护等）**不接受直接 PR**，请先在
[Issues](https://github.com/zhu1090093659/dsh-web/issues) 提 issue
讨论，确认后由维护者处理。非三类范围的 PR 会被
`.github/workflows/reject-non-content-pr.yml` 自动关闭（仅文档类 PR 由
`reject-docs-pr.yml` 处理）；仓库所有者、机器人与拥有写权限的协作者
（维护者）的 PR 不受此限制。

## 开发前置

- Node.js >= 22 与 pnpm 11；
- 插件只基于官方 NPM SDK（`@deepseek-ai/*`），**禁止修改 DSH 源码**、禁止
  tsconfig 指向任何 DSH 源码 checkout；
- 认证：token 放用户级 `~/.npmrc`，项目 `.npmrc` 只留 scope 映射（详见
  [docs/plugins.md](docs/plugins.md)）。

## 快速开始

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
git checkout dev                                 # 开发基线：dev 分支
git fetch origin && git rebase origin/dev        # 提交 / 提 PR 前同步最新 dev
pnpm install
pnpm -r build
pnpm typecheck && pnpm test && pnpm docs:check   # 提交前必过
```

## 提交规范

提交信息格式 `type(scope): subject`，type 用 `feat` / `fix` / `chore` /
`docs` / `test` / `refactor` / `perf`，scope 是包名或主题，关联 issue 时
subject 末尾追加 `(#123)`。示例：`fix(task-board,ssh): hide composer under
active panel (#76 #87)`。提交信息禁止 emoji（全仓规则）。

## 提 PR 前检查清单

1. **门禁全绿**：`pnpm typecheck` / `pnpm test` / `pnpm test:scripts` /
   `pnpm docs:check`；涉及聚合包、市场、皮肤中心时另跑
   `pnpm aggregate:check` / `pnpm market:check` / `pnpm skin-center:check`。
2. **文档同步**：改包 README 必须同 PR 维护中英双语三件套（`README.md` +
   `README.zh.md` + `README.i18n.yaml`），改完任一侧后重录配对记录：

```sh
pnpm docs:write-pair <包目录名>   # 如 dsh-ssh 或 xp
```

3. **无 emoji**：代码、注释、文档、提交信息均不得出现 emoji（CI 有全树
   检查）。
4. **一次性记录**（任务交接、验证快照）放 `docs/archive/`，不进长期文档目录。
5. **按模板填 PR**：摘要、涉及包、**PR 类别（必填，决定自动分派给哪位
   协作者）**、类型、最新代码确认、AI 编码披露、仓库规范检查、本地验证结果；**测试证据与上游同步必填**：提供自己本地测试
   的证据，并附上同步上游最新 `dev` 分支（`git fetch origin && git
   rebase origin/dev`）后重新测试通过的证据。文本类改动可不附截图；
   **视觉修复 / 用户可见变更必须附截图**（视觉修复还需完成态或修复前后
   对比截图），且视觉修复必须使用支持图像输入的多模态 AI 模型完成——
   使用纯文本模型（如 deepseek-chat / deepseek-reasoner / gpt-3.5）修复
   的视觉类 PR 不予接受。缺少上述证据的 PR 不予接受。
6. **AI 编码披露**：使用 AI 编码时在 PR 模板中如实披露模型与工具。

## 三类内容贡献怎么做

### 插件申请（社区插件索引登记）

插件在贡献者自己的仓库实现（官方 cordis bundle 标准：`dsh.bundle.patch`
指向 `cordis.patch.yml`、`dsh.client` 浏览器半区、仅基于
`@deepseek-ai/*` NPM SDK，不修改 DSH 源码），然后按
[docs/plugins.md](docs/plugins.md) 的登记说明在
`packages/dsh-community-plugins/community.json` 追加条目，运行
`node scripts/community-index` 重新生成注册表并提交（含生成的
`src/client/generated/community.ts`），随 PR 提交，PR 类别勾选
「社区插件索引」。

### 皮肤增加（新皮肤收录）

`node scripts/dsh-skin-new` 生成纯资产骨架（无 package.json），
`node scripts/dsh-skin validate` 校验后按皮肤契约完善（skin.json v2、
skin.css token 重映射，可选 patches.css / hooks.mjs / assets/），用
`node scripts/capture-previews <id>` 重拍 `preview/{light,dark}.png`，
`pnpm market:build` 与 `pnpm skin-center:check` 通过后随 PR 提交，
PR 类别勾选「皮肤 / 皮肤中心」。皮肤收录到我们部署的 dsh-market.com
服务器（Workshop）供用户按需安装，默认安装不带（见上文 PR 范围）。

### 宠物增加（新宠物收录）

按 [dsh-pet README](packages/dsh-pet/README.zh.md) 的宠物契约新增
`packages/dsh-pet/assets/<id>/`（`pet.json` v2 + 8 列 × 9 行图集，
可选 `previews/`、`voice.json` 与状态装饰），在
`src/registry.test.ts` 增加该 manifest 的归一化断言，同步维护 dsh-pet
README 中英三件套（`pnpm docs:write-pair dsh-pet`），
`pnpm --filter @linxin666/dsh-pet build`、`pnpm --filter @linxin666/dsh-pet test`
与 `pnpm typecheck` 通过后随 PR 提交，PR 类别勾选「插件功能」（该类别括号内含宠物项），PR 类型勾选「新宠物收录」。

### 范围边界

新增内置插件包 / 全新功能不属于内容贡献：仅接受 Issue，确认后由维护者
实现（`node scripts/dsh-plugin-new <name>` 等脚手架命令供维护者使用）。
内部新增 / 删除包或改皮肤清单时，同步更新
[docs/publish-prep.md](docs/publish-prep.md) 的发布清单快照。

## 文档体系

仓库采用分层指令（渐进式上下文），写代码 / 写文档前按需阅读：

| 文件 | 内容 | 何时读 |
| --- | --- | --- |
| [AGENTS.md](AGENTS.md) | 布局、命令、全局约定、开发与贡献流程 | 每个会话 |
| [packages/AGENTS.md](packages/AGENTS.md) | 包级规则：SDK 约束、bundle 形态、测试纪律 | 改 packages/ 前 |
| [docs/AGENTS.md](docs/AGENTS.md) | 文档标准：结构分层、写作规则、i18n 配对、预算 | 写文档前 |
| 各包 `AGENTS.md` | 该包特有规则（如 dsh-ssh 安全模型） | 改对应包前 |
| [docs/development.md](docs/development.md) | 日常开发与发布流程 | 需要细节时 |
| [docs/i18n.md](docs/i18n.md) | 双语文档配对契约 | 改 README 时 |

## 发布

发布由维护者推送 `vX.Y.Z` tag 触发（`.github/workflows/release.yml`），tag 是
版本唯一来源；`scripts/verify-version.mjs` 校验每个包版本与 tag 一致。
贡献者无需关心发布，但新增包时必须保证包版本与仓库版本节奏一致。

## Issue 与讨论

- Bug / 功能请求用 [Issue 模板](.github/ISSUE_TEMPLATE/standard_issue.yml) 提交，
  Bug 用「Bug 报告」表单（自动附加 `bug` 标签），需附截图、冒烟测试与引用代码；
- 社区交流见根 README 的「社区」小节；
- 提 Issue 前先按标签检索（`bug` / `enhancement` / `question` /
  `good first issue` / `duplicate`）并搜索关键词，确认没有重复再提交；
- 标签体系、分类标准与关闭流程见 [ISSUE_TRIAGE.md](ISSUE_TRIAGE.md)；
- 已解决、重复或已回答的 Issue 会被维护者关闭并附说明，如需继续跟进请
  在评论区说明或重开。
