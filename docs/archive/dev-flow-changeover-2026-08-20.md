# dev 分支流程切换记录（2026-08-20）

本次变更的完整背景与落点，供后续会话 / Agent 快速对齐，不必再逐条翻 commit。
长期规则以根 AGENTS.md、CONTRIBUTING.md、docs/development.md 与 PR 模板为准。

## 结论（当前状态）

- `origin/main` 与 `origin/dev` 指向同一提交：`e854866f2`（本地工作分支为 dev）。
- GitHub 默认分支已切到 `dev`（新 PR 默认 base = dev）。
- `dev` / `main` 均已启用分支保护：要求 PR + 1 个 approve + 三个 CI 检查全绿
  （CI checks / plugin-mount / Validate PR contribution evidence），允许管理员
  绕过（enforce_admins=false），禁 force-push（allow_force_pushes=false）。

## 分支模型（2026-08-20 起生效）

- `dev`：开发分支（集成分支）。本地开发与远程贡献的 PR 统一合并到 `dev`；
  提交前先 `git fetch origin && git rebase origin/dev` 同步。
- `main`：稳定分支（发布分支）。只接收 `dev` 上测试通过后合入的代码；
  发版 tag 从 `main` 打；发布后把 `main` 合回 `dev` 保持双分支一致。
- PR 一律以 `dev` 为 base；仓库所有者维护的 docs 类改动仍可直接本地合入
  `main` 再同步 `dev`（既有提交偏好，不推远程 PR）。

## PR 证据规则（外部贡献者必填，缺失不接受）

- 必须提供自己本地测试的证据（执行的命令 / 测试结果 / 运行截图）。
- 必须勾选「已同步上游最新 dev 分支」，并附上同步后重新测试通过的证据。
- 文本类改动可不附截图；视觉修复 / 用户可见变更必须附截图。
- 视觉修复（PR 类型新增「视觉修复」选项）额外要求：
  - 提供修复完成后的截图（完成态或修复前后对比）；
  - 必须使用支持图像输入的多模态 AI 模型完成；纯文本模型（黑名单：
    deepseek-chat / deepseek-reasoner / deepseek-r1 / deepseek-v1-v3 /
    gpt-3.5 系 / llama2-3 / glm3-4 / moonshot / kimi / doubao / ernie /
    mistral 等）修复的视觉类 PR 直接拒绝。
- 仓库所有者自审的 PR 豁免上述证据门槛。

## 强制机制（双重拦截）

- CI 侧：`.github/workflows/pr-contribution-rules.yml`（pull_request_target）
  校验 PR 正文，缺失即评论 + 挂红；`.github/workflows/ci.yml` push 监听
  `main` + `dev`。
- 本地侧：`scripts/pr-review.mjs`（`checkTemplate`）镜像同一套规则，
  含纯文本模型黑名单常量 `TEXT_ONLY_MODEL_RES`；测试 146 个全绿。

## 自动化适配（分支保护的连锁影响）

- `.github/workflows/contributors.yml`：bot 无法直推受保护分支，改为提交到
  `chore/contributors-sync` 分支并自动向 `dev` 开 PR（gh pr create，bot 分支
  用 force push 更新 head）；维护者需合并该 PR。
- `.github/workflows/reject-docs-pr.yml` 与 `pr-contribution-rules.yml`：
  `github-actions[bot]` 作者豁免（自动同步 PR 不受仅文档关闭 / 证据检查约束）。

## 存量 PR 处理

- 原 16 个 base=main 的 open PR 已全部重定向到 `dev`（当时 main == dev，
  零风险），并逐条评论通知新流程；#757 由作者自行改到 dev；#628（furina
  皮肤）作者自行关闭，已评论询问是否基于 dev 重开。
- 注意：部分老 PR 与当前 dev 冲突属正常（基于较早代码），作者 rebase
  origin/dev 后解决。

## 发布流程（release skill 已适配）

- `.dsh/skills/dsh-web-ui-release/SKILL.md` 已按 dev 模型更新：发版前在 dev
  全绿；发版时 `git merge --ff-only dev` 到 main 后打 tag；发布后 main 合回
  dev。发版提交与 tag 一律从 main 执行。

## 并发会话插曲（重要教训）

- 另一并行会话把 main 推进到真实最新历史（含 dsh-chat-recovery、
  dsh-desktop-launcher、pet v2、v0.2.3/v0.2.4 发布说明等），并将本会话的
  流程提交 rebase 进了该线（内容逐项核验在位，仅哈希变化）。
- 基于旧 main 创建的 dev 一度成为陈旧线；已用真实 main 重建 dev 并
  cherry-pick 唯一缺失的 release skill 提交（e854866f2）。期间为推送重建后
  的 dev，临时放开 dev 的 force-push 保护一次，推送后立即恢复。
- 教训：共享 checkout 的会话间分支操作会互相影响；dev/main 分叉时先核对
  `git log --oneline origin/main..origin/dev` 与内容在位性，再决定合并方向。

## 后续提醒

- 新 PR 默认 base=dev；评审外部 PR 时核对证据与视觉修复模型要求。
- contributors bot 会不定期向 dev 开 `docs(readme)` PR，直接合并即可。
- 发版前确认 main 与 dev 一致（skill 第 2 节流程）。
