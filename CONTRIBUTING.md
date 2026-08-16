# 贡献指南（Contributing）

欢迎为 dsh-web-ui（DSH Web GUI 插件与皮肤全家桶）贡献代码。本文件是贡献者的
入口；仓库的全部规则与机制以 [AGENTS.md](AGENTS.md)（及其分层指令）为准，
冲突时以 AGENTS.md 为准。

## PR 范围：接受修复、增强与优化，暂不接受全新功能

本仓库接受以下 PR：

- **修复**：bug 修复、兼容性适配；
- **增强 / 优化**：现有功能的改进、性能 / 体验优化、维护与文档修正；
- **新皮肤**：属于内容贡献，始终欢迎直接提 PR。

暂**不接受**全新特性 / 新功能的 PR；有相关需求请先在
[Issues](https://github.com/zhu1090093659/dsh-web-ui/issues) 提 issue 讨论，
确认后再开 PR。

## 开发前置

- Node.js >= 22 与 pnpm 11；
- 插件只基于官方 NPM SDK（`@deepseek-ai/*`），**禁止修改 DSH 源码**、禁止
  tsconfig 指向任何 DSH 源码 checkout；
- 认证：token 放用户级 `~/.npmrc`，项目 `.npmrc` 只留 scope 映射（详见
  [docs/plugins.md](docs/plugins.md)）。

## 快速开始

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
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
   `pnpm docs:check`；涉及聚合包、画廊、皮肤中心时另跑
   `pnpm aggregate:check` / `pnpm gallery:check` / `pnpm skin-center:check`。
2. **文档同步**：改包 README 必须同 PR 维护中英双语三件套（`README.md` +
   `README.zh.md` + `README.i18n.yaml`），改完任一侧后重录配对记录：

```sh
pnpm docs:write-pair <包目录名>   # 如 dsh-ssh 或 qq98
```

3. **无 emoji**：代码、注释、文档、提交信息均不得出现 emoji（CI 有全树
   检查）。
4. **一次性记录**（任务交接、验证快照）放 `docs/archive/`，不进长期文档目录。
5. **按模板填 PR**：摘要、涉及包、类型、最新代码确认、AI 编码披露、仓库
   规范检查、本地验证结果；用户可见功能变更附截图 / 视频证据。
6. **AI 编码披露**：使用 AI 编码时在 PR 模板中如实披露模型与工具。

## 新增包或皮肤

> 范围约束：外部贡献者目前**不要直接提交新插件 / 全新功能 PR**，请先提 issue；
> 对现有插件的增强 / 优化与新皮肤不受此限制，可直接提 PR。下列命令供 issue
> 确认后的实现使用。

- 插件：`node scripts/dsh-plugin-new <name>` 生成骨架（自动含双语 README
  三件套与 AGENTS.md 模板），然后按 [docs/plugins.md](docs/plugins.md)
  注册进 `packages/dsh-web-ui-all/aggregate.yml` 并运行
  `node scripts/aggregate.mjs`。
- 皮肤：`node scripts/dsh-skin-new` 生成骨架，改完运行
  `pnpm --filter @linxin666/dsh-skins build` 把皮肤资产并入聚合包。
- 新增 / 删除包或改皮肤清单时，同步更新 [docs/publish-prep.md](docs/publish-prep.md)
  的发布清单快照。
- 第三方插件想进「社区插件」索引卡片（设置 → 插件配置 → Web UI 插件）时，按
  [docs/plugins.md](docs/plugins.md) 的登记说明在
  `packages/dsh-web-ui-settings/community.json` 追加条目并重新生成注册表
  （`node scripts/community-index`）。

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

- Bug / 功能请求用 [Issue 模板](.github/ISSUE_TEMPLATE/standard_issue.yml) 提交；
- 社区交流见根 README 的「社区」小节；
- 提 Issue 前先按标签检索（`bug` / `enhancement` / `question` /
  `good first issue` / `duplicate`）并搜索关键词，确认没有重复再提交；
- 标签体系、分类标准与关闭流程见 [ISSUE_TRIAGE.md](ISSUE_TRIAGE.md)；
- 已解决、重复或已回答的 Issue 会被维护者关闭并附说明，如需继续跟进请
  在评论区说明或重开。
