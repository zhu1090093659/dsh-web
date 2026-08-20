---
name: dsh-web-ui-contribution
description: Submit a bug fix or issue to the dsh-web-ui monorepo (zhu1090093659/dsh-web-ui) the correct way — target the dev branch, follow the PR template gates, satisfy the automated contribution-evidence checks, create compliant issues that survive the template-enforcer bot, and push from the Xeehho fork. Use when the user wants to fix a bug, open an issue, or submit/update a PR in the dsh-web-ui repo.
whenToUse: The user reports a dsh-web-ui bug, wants to submit a PR or issue to zhu1090093659/dsh-web-ui, needs to update an existing PR per maintainer feedback, or asks how to contribute to the repo (提 PR / 提 issue / 修复问题 / 更新 PR).
---

# dsh-web-ui 贡献流程（提 PR / 提 Issue）

本技能指导向 **zhu1090093659/dsh-web-ui**（DSH Web GUI 插件与皮肤全家桶 monorepo）提交
bug 修复 PR 与 Issue 的完整流程。仓库是浅克隆 + 稀疏检出，贡献走 **Xeehho fork + PR**。
机器人门禁严格：PR 有「贡献证据」校验，Issue 有「模板执行器」自动关闭，必须逐项满足。

## 仓库与账号关键事实

- 仓库：`git@github.com:zhu1090093659/dsh-web-ui.git`（owner: zhu1090093659）
- 本机身份：Xeehho（SSH key 与 Windows 凭据管理器均为 Xeehho）——**对主仓库无写权限**，
  贡献必须走 fork：`git@github.com:Xeehho/dsh-web-ui.git`（已有 fork，remote 名 `fork`）
- GitHub API 凭据：`git credential fill`（输入 `protocol=https\nhost=github.com\n\n`）可拿到
  Xeehho 的 PAT（40 字符 classic token），用于 API 创建 PR / Issue / 评论
- 开发分支：**dev**（集成分支）；main 只接收从 dev 合入的代码。PR base 一律为 dev
- 本机克隆在 `C:\AI\dsh-web-ui`（浅克隆 + 稀疏检出，`scripts/` 等目录可能缺失，
  导致 `pnpm docs:check` 等门禁在本机跑不了——CI 会跑，本地尽力跑能跑的）

## 一、提 Bug 修复 PR（推荐路径：bug 修复直接提 PR，无需先提 issue）

### 1. 基于 dev 建分支

```sh
cd C:\AI\dsh-web-ui
git fetch origin dev && git update-ref refs/remotes/origin/dev FETCH_HEAD
git checkout -b fix/<kebab-subject> origin/dev
```

### 2. 改代码 + 测试 + 构建

```sh
cd packages/<affected-package>
pnpm typecheck
pnpm exec vitest run tests/<spec>.spec.ts
pnpm build        # 提交构建产物（lib/ 随源码提交，仓库有产物一致性门禁）
```

- 仓库规则：禁止 emoji（代码/注释/文档/提交信息）；Conventional Commits
  （`fix(skin-center): subject`）；typecheck / test 通过；改 README 需中英三件套
- 注意：Windows 上 symlink 相关测试会因 EPERM 失败（环境限制，非代码问题），
  在 PR 里如实说明即可

### 3. 提交 + 推送到 fork

```sh
git add <changed files>
git commit -m "fix(skin-center): <subject>"
git remote add fork git@github.com:Xeehho/dsh-web-ui.git   # 首次
git push -f fork fix/<kebab-subject>
```

### 4. 创建 PR（API，head = `Xeehho:<branch>`，base = `dev`）

用 `git credential fill` 取 token，POST `/repos/zhu1090093659/dsh-web-ui/pulls`：

```text
title: fix(skin-center): <subject>
head: Xeehho:<branch>
base: dev
body: 按 dev 分支 PR 模板完整填写（见下）
```

**PR body 必须满足「Validate PR contribution evidence」校验**（工作流
`.github/workflows/pr-contribution-rules.yml`），逐项核对：

1. **PR 类型**：至少勾选一项，格式 `- [x] <选项全文>`（整行精确匹配）
2. **最新代码确认**：必须**整行**为
   `- [x] 我已基于最新 \`dev\` 分支开发，或在提交前已 rebase / 合并最新 \`dev\`。`
   （反引号不能丢，`\`dev\`` 必须保留）
3. **测试证据与上游同步**：勾选两项（整行匹配模板原文），
   「本地测试证据」附命令输出，「上游同步」说明已 rebase origin/dev 并重测
4. **视觉修复要求**：若 PR 属视觉/UI 修复，勾选「提供修复完成截图」+
   「多模态模型」，**AI 模型名不能匹配黑名单**（`^deepseek$`、deepseek-chat/reasoner/r1、
   gpt-3.5、llama2/3、glm3/4、moonshot/kimi、doubao、ernie/文心、mistral）。
   写具体模型如 `DeepSeek（多模态验证：describe_image 工具读取视觉证据图确认修复效果）`
5. **本地验证**：`执行的命令：` 与 `结果摘要：`（中文冒号）后必须有内容
6. **用户可见变更证据**：该节内必须含图片链接（`![...](url)` 或 gist raw 图）
7. **AI 编码披露**：**额外加一行**精确的 `- [x] 完全 AI 编码`
   （校验脚本 `hasCheckedLine(ai, '完全 AI 编码')` 是整行匹配，模板选项带后缀不匹配）

**编码陷阱**：PATCH body 时用 PowerShell 双引号 here-string 会吞反引号、破坏中文。
**必须用单引号 here-string（`@'...'@`）生成 body 文件（UTF-8 无 BOM）**，再 base64 编码，
node 解码后 PATCH（避免脚本内嵌中文损坏）。校验用 `verify-pr-body` 风格脚本复刻
GitHub 判定逻辑，本地确认全绿再等 CI。

### 5. 视觉证据上传

无写权限无法传 `user-images.githubusercontent.com`，用 gist 托管：

```text
POST /gists  { files: { '<name>.png': { content: <base64> } } }
→ raw: https://gist.githubusercontent.com/Xeehho/<gist-id>/raw/<name>.png
```

### 6. 等待校验 + 维护者处理

- body 编辑会触发 `Validate PR contribution evidence` 重跑；
  `mergeable_state: clean` 表示通过，`blocked` 是等待 review/合并的正常状态
- 维护者（zhu1090093659）会在 PR 评论里给要求，按 1-4 步更新即可

## 二、提 Issue（必须符合模板，否则机器人自动关闭）

机器人（`.github/workflows/issue-template-enforcer.yml`）判定逻辑：

- **Bug 报告类型必须带 `bug` label**——Xeehho 无 admin 权限加不了 label，
  所以**不要用「Bug 报告」类型**（会被自动关闭）
- 用「**问题**」类型（`standard_issue.yml` 表单）：只需 6 个必填部分
  （涉及插件 / Issue 类型 / 摘要 / 预期结果 / 详情 / 环境信息），
  不需要 label、不需要截图、不需要代码引用和补丁
- 标题前缀 `[Issue]: `；「提交前查重」勾选 `- [x] 我已搜索过 open/closed 的 Issue...`

API 创建：

```text
POST /repos/zhu1090093659/dsh-web-ui/issues
title: [Issue]: <subject>
labels: []        # 不填 bug label（Xeehho 无权限）
body: 按「问题」模板 6 部分填写
```

创建后等 15 秒确认机器人没关（state 保持 open、无 github-actions 关闭评论）。
若需 @ 作者：在 issue 评论里写 `@zhu1090093659 ...`。

## 三、常见坑速查

| 坑 | 解法 |
|---|---|
| push 被拒（Permission denied） | 推 `fork` remote（Xeehho/dsh-web-ui），不是 origin |
| PR base 是 main | PATCH `{"base":"dev"}` |
| 校验失败但看不出原因 | 本地复刻 `pr-contribution-rules.yml` 判定逻辑逐项检查 body |
| body 中文/反引号损坏 | 单引号 here-string 生成 UTF-8 无 BOM 文件 + base64 传输 |
| AI 模型名匹配黑名单 | 写具体多模态描述，避免裸 `deepseek` 等 |
| Issue 被机器人关闭 | 用「问题」类型，不带 bug label |
| 本机跑不了 docs:check | 稀疏检出缺 scripts/，CI 会跑；本地只跑 typecheck+test+build |

## 四、完成后自查清单

- [ ] PR base = dev，head 来自 Xeehho fork
- [ ] 已 rebase origin/dev 且本地测试通过
- [ ] body 全部校验项本地复刻通过（含精确勾选行、图片证据、多模态模型名）
- [ ] `Validate PR contribution evidence` CI 显示 success
- [ ] 视觉类修复附真实截图（gist 托管）+ describe_image 多模态验证
