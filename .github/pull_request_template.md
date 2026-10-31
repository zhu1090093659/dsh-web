> 提 PR 前请阅读 [CONTRIBUTING.md](../CONTRIBUTING.md) 与 [AGENTS.md](../AGENTS.md)；
> 提交信息用 Conventional Commits（`type(scope): subject`），禁止 emoji。
> 本仓库不再接受外部内容贡献：皮肤增加、宠物增加、社区插件索引登记与 agent 预设收录已全部迁至各自的独立仓（[dsh-skins](https://github.com/zhu1090093659/dsh-skins) / [dsh-pet](https://github.com/zhu1090093659/dsh-pet) / [dsh-community-plugins](https://github.com/zhu1090093659/dsh-community-plugins) / [dsh-presets](https://github.com/zhu1090093659/dsh-presets)）；在本仓按这些类别提交的 PR 会被自动关闭并重定向到对应仓库。
> 标准政策：其余改动（修复 / 增强 / 全新功能 / 文档 / 测试 / 维护）不接受直接 PR，请先提 Issue 讨论；仓库所有者、机器人与拥有写权限的协作者（维护者）不受此限制，可直接提交任意改动。
> 标准政策：仅文档类 PR（标题以 `docs:` 开头或勾选「仅文档」）不接受，会被自动关闭；文档改动请先提 Issue 讨论（仓库所有者、机器人与拥有写权限的协作者不受此限制）。
> **临时开放期（2026-10-27 起）：上述标准政策暂停执行——除四类内容贡献外，外部 PR 不再被自动关闭，可直接提交；纯文档 PR 同样接收。恢复方式见 CONTRIBUTING.md 的「临时开放期」小节。**
## 摘要（Summary）

<!-- 用一两句话说明改了什么、为什么改。 -->

## 涉及包（Affected Packages）

<!-- 勾选本次改动涉及的包；仅脚本改动（维护类）可全部不勾选并说明。 -->

- [ ] 任务看板 `packages/dsh-task-board`
- [ ] Git 图谱 `packages/dsh-git-graph`
- [ ] 右侧面板 `packages/dsh-aionui-panel`
- [ ] SSH 远程运维 `packages/dsh-ssh`
- [ ] 宠物（[dsh-pet](https://github.com/zhu1090093659/dsh-pet) 仓）
- [ ] 预设中心（[dsh-presets](https://github.com/zhu1090093659/dsh-presets) 仓）
- [ ] 皮肤 / 皮肤中心（[dsh-skins](https://github.com/zhu1090093659/dsh-skins) 仓）
- [ ] 聚合包 / 设置 `packages/dsh-web-all` / `packages/dsh-web-settings`
- [ ] 其他（请说明）

## PR 类别（PR Category）

<!-- 必填。勾选本 PR 最贴近的类别（可多选），用于机器人按类别自动分派给协作者。注意：本仓库不再接受外部内容贡献——皮肤 / 皮肤中心、社区插件索引与预设增加都已迁至独立仓（dsh-skins / dsh-community-plugins / dsh-presets），勾选这些类别的 PR 会被自动关闭并重定向；「插件功能」里的功能改动与「维护 / 其他」也不在接受范围，会被自动关闭，请改提 Issue；仓库所有者与拥有写权限的协作者（维护者）不受此限制。 -->

- [ ] 皮肤 / 皮肤中心（新皮肤收录、皮肤样式）—— 已迁至 [dsh-skins](https://github.com/zhu1090093659/dsh-skins) 仓，本仓提交会被自动关闭并重定向
- [ ] 插件功能（任务看板 / Git 图谱 / 右侧面板 / 远程 Web UI / SSH / 设置 / 聚合包）
- [ ] 社区插件索引 —— 已迁至 [dsh-community-plugins](https://github.com/zhu1090093659/dsh-community-plugins) 仓，本仓提交会被自动关闭并重定向
- [ ] 预设 / 预设中心 —— 已迁至 [dsh-presets](https://github.com/zhu1090093659/dsh-presets) 仓，本仓提交会被自动关闭并重定向
- [ ] 维护 / 其他

## PR 类型（PR Type）

<!-- 勾选所有适用的类型；四类内容贡献（新皮肤收录 / 新宠物收录 / 社区插件索引 / 新预设收录）都已在各自的独立仓提交。 -->

- [ ] 面向用户的功能或行为变更
- [ ] Bug 修复
- [ ] 视觉修复（UI / 视觉类问题的修复）
- [ ] 增强 / 优化（现有功能的改进、性能 / 体验优化）
- [ ] 新皮肤收录（内容贡献，在 [dsh-skins](https://github.com/zhu1090093659/dsh-skins) 仓提交；本仓提交会被自动关闭并重定向）
- [ ] 新宠物收录（内容贡献，在 [dsh-pet](https://github.com/zhu1090093659/dsh-pet) 仓提交；本仓提交会被自动关闭并重定向）
- [ ] 新预设收录（内容贡献，在 [dsh-presets](https://github.com/zhu1090093659/dsh-presets) 仓提交；本仓提交会被自动关闭并重定向）
- [ ] 维护 / 重构

<!-- 仅文档类 PR 不接受，会被自动关闭；文档改动请先提 Issue 讨论。 -->

## 最新代码确认（Latest Codebase Confirmation）

- [ ] 我已基于最新 `dev` 分支开发，或在提交前已 rebase / 合并最新 `dev`。

同步命令：

<!-- 示例：git fetch origin && git rebase origin/dev -->

## 测试证据与上游同步（Test Evidence & Upstream Sync）

<!-- 必填。缺少下列任一证据的 PR 不予接受；文本类改动可不附截图，但必须提供测试证据。 -->

- [ ] 我提供了自己本地测试的证据（执行的命令 / 测试结果 / 运行截图）。
- [ ] 我已同步上游最新 `dev` 分支（`git fetch origin && git rebase origin/dev`），并附上同步后重新测试通过的证据（视觉 / 用户可见变更附截图）。

## 视觉修复要求（Visual Fix Requirements）

<!-- 仅当 PR 类型勾选了「视觉修复」时必填；纯文本类改动可跳过本节。 -->

- [ ] 我提供了修复完成后的截图（完成态或修复前后对比）。
- [ ] 修复使用的 AI 模型支持图像输入（多模态模型）；未使用 AI 编码时此项视为满足。

<!-- 使用纯文本模型（如 deepseek-chat / deepseek-reasoner / gpt-3.5 等不支持图像输入的模型）进行视觉修复的 PR 不接受；使用的多模态模型请在「AI 编码披露」节填写。 -->

## AI 编码披露（AI Coding Disclosure）

<!-- 必填。勾选一项，且模型 / 工具字段不得留空。 -->

- [ ] 完全 AI 编码：全部编程改动由 AI 产出，并由贡献者接受 / 审查。
- [ ] 部分 AI 辅助：AI 帮助编写或修改了部分编程改动。
- [ ] 未使用 AI 编码辅助。

使用的 AI 模型：

<!-- 使用 AI 时必填；未使用 AI 时填 N/A。示例：DeepSeek、GPT-5、Claude Sonnet 4。 -->

使用的编码 Agent 工具：

<!-- 使用 AI 时必填；未使用 AI 时填 N/A。示例：DeepSeek Harness、Codex、Claude Code、Cursor。 -->

## 仓库规范检查（Repo Rules）

<!-- 本仓库硬性规范，请逐项确认。 -->

- [ ] 未修改 DSH 官方源码，仅基于官方 NPM SDK（`@deepseek-ai/*`）开发。
- [ ] 未新增指向 DSH 源码 checkout 的 tsconfig `extends` / `paths` / `references`。
- [ ] 新增包目录以 `dsh-` 前缀命名（如 `packages/dsh-xxx`）。
- [ ] 所有新增 / 修改文件不含任何 emoji 字符。
- [ ] 改动包 README 时同步维护中英双语三件套（`README.md` / `README.zh.md` / `README.i18n.yaml`）并运行 `pnpm docs:check`。

## 贡献者版权声明（Contributor Copyright）

<!-- 可选。若本 PR 贡献的是插件或预设，可在项目 README 末尾「来源与版权」的版权表中追加一行声明你自己的版权（包 / 来源 / 版权三列，格式参考表中现有行）；不声明则维持现有版权归属。 -->

## 新预设收录（New Agent Preset）

<!-- 预设已迁至 dsh-presets 仓。本仓不再接受预设 PR：提交到本仓会被自动关闭并重定向。投稿清单见该仓的 CONTRIBUTING.md 与 presets/README.md。 -->

## 本地验证（Local Validation）

执行的命令：

```bash
# 示例：改动包目录内 pnpm build，涉及聚合包时跑 aggregate:check
pnpm build
```

结果摘要：

<!-- 失败也要写明。不要留空。 -->

## 用户可见变更证据（Local Feature Evidence）

<!--
面向用户的功能或行为变更必填。
附截图或短视频，展示：
- 本地加载的插件来自本 PR / 最新代码
- 功能已启用 / 配置（如适用）
- 成功使用并展示可见结果
- 涉及 agent 循环的功能展示后续 / 结果反馈
-->

证据：

<!-- 粘贴 GitHub 图片 / 视频附件、Markdown 图片或直接图片 / 视频链接。纯内部改动（无用户可见变更）可填 N/A。 -->