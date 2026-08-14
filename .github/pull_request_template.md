## 摘要（Summary）

<!-- 用一两句话说明改了什么、为什么改。 -->

## 涉及包（Affected Packages）

<!-- 勾选本次改动涉及的包；仅文档/脚本改动可全部不勾选并说明。 -->

- [ ] 任务看板 `packages/dsh-task-board`
- [ ] Git 图谱 `packages/dsh-git-graph`
- [ ] 右侧面板 `packages/dsh-aionui-panel`
- [ ] 远程 Web UI `packages/dsh-remote-web-ui`
- [ ] SSH 远程运维 `packages/dsh-ssh`
- [ ] 实时令牌统计 `packages/dsh-live-stats`
- [ ] 宠物 `packages/dsh-pet`
- [ ] 皮肤 / 皮肤中心 `packages/dsh-skins` / `packages/skins`
- [ ] 聚合包 / 设置 `packages/dsh-web-ui-all` / `packages/dsh-web-ui-settings`
- [ ] 其他（请说明）

## PR 类型（PR Type）

<!-- 勾选所有适用的类别。 -->

- [ ] 面向用户的功能或行为变更
- [ ] Bug 修复
- [ ] 仅文档
- [ ] 维护 / 重构

## 最新代码确认（Latest Codebase Confirmation）

- [ ] 我已基于最新 `main` 分支开发，或在提交前已 rebase / 合并最新 `main`。

同步命令：

<!-- 示例：git fetch origin && git rebase origin/main -->

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
皮肤改动需同时展示换肤后的界面效果。
-->

证据：

<!-- 粘贴 GitHub 图片 / 视频附件、Markdown 图片或直接图片 / 视频链接。仅文档或纯内部改动可填 N/A。 -->
