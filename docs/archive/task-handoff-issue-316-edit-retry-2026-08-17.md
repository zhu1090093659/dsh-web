# 任务交接：issue #316 edit message & retry（待人工审核合并）

- 日期：2026-08-17
- 分支：`feat/issue-316-edit-retry`（基于当时最新 main e9ffe35e；后 main 推进到
  807c3e92，分支已再次 rebase，无冲突）
- 工作树：`/private/tmp/dsh-web-ui-issue316`（保留以便审核，合并完成后可用
  `git worktree remove /private/tmp/dsh-web-ui-issue316` 删除）

## 变更内容

- 新插件包 `packages/dsh-chat-recovery`（`@linxin666/dsh-chat-recovery`，v0.1.19，
  private，BSD-3-Clause，行 id `ui-chat-recovery`）：
  - 编辑最近消息：`conversation.chat.turnTail` 上的「编辑」按钮，行内编辑态，
    保存即从该消息之前的 turn/end 前缀 fork 子分支并重发编辑文本，原会话不动；
    首轮消息退化为同工作区空白会话；仅纯文本消息可编辑。
  - 重试监督：可恢复失败（超时/网络/服务端/限流/空响应，且无工具活动）自动最多
    额外重试 5 次、指数退避（1s/2s/4s/8s/16s）、可取消；每次重试从失败轮次之前
    前缀 fork 新分支并只 prompt 一次原文（不重复用户消息、失败片段不进下一次请求）；
    状态行在 `conversation.input.dock`（次数/等待/最终原因/取消/立即重试）；
    其余失败只给手动重试按钮；主机 llm/retry 链进行时让位。
- 聚合注册：`packages/dsh-web-ui-all/aggregate.yml`（patchFrom + deps）、
  `node scripts/aggregate.mjs` 重新生成 cordis.patch.yml 与 package.json；
  `docs/publish-prep.md` 增行（共 24 包）；包 README 中英三件套已配对。

## 验证证据（全部在工作树内实测）

- `pnpm typecheck`：全仓通过。
- `pnpm test`：本包 57/57 通过；全仓仅 dsh-ssh 的「sftp (real sshd)」1 例失败，
  与本次改动无关（主 checkout 同样失败，环境性）。
- `pnpm build`：全仓通过（含聚合包 web-ui-all 与 chat-recovery 的 lib/client 产物；
  浏览器 bundle 仅 require react，纯度门通过）。
- `pnpm aggregate:check`、`pnpm docs:check`、`pnpm test:scripts`（90/90）、
  `pnpm runtime-deps:check`：全部通过。

## 为什么未合并到 main（待人工审核）

主 checkout 的工作树里存在另一会话未提交的 WIP（aggregate id namespace 重构，见
同日 task-handoff-aggregate-id-namespace 文档），其中
`packages/dsh-web-ui-all/aggregate.yml` 与 `packages/dsh-web-ui-all/cordis.patch.yml`
恰为本分支要改的文件。直接合并会覆盖该会话未提交改动，按并行开发纪律未执行
`git merge --ff-only feat/issue-316-edit-retry` 被 git 拒绝（local changes would be
overwritten），已保留双方更改。

## 人工审核后的合并步骤

1. 等另一会话提交其 WIP 到 main（或确认其改动已落地）；
2. `git -C /private/tmp/dsh-web-ui-issue316 rebase main`；若与 aggregate 重构冲突，
   保留双方更改（该会话的 id 命名空间改动 + 本分支的 chat-recovery 行）后再继续；
3. `git checkout main && git merge --ff-only feat/issue-316-edit-retry`
   （或 --no-ff 保留合并记录）；
4. 重跑 `pnpm aggregate:check` 确认生成文件与最终 aggregate.yml 一致；
5. `git worktree remove /private/tmp/dsh-web-ui-issue316`。
