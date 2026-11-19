# AGENTS.md — dsh-task-board-ssh

任务看板的外部提供方扩展（把卡片送到经 dsh-ssh 触达的远端主机上执行）。本文件只写本包特有规则。

## 与看板、dsh-ssh 的边界

- 本包不 import 看板或 `dsh-ssh` 的任何 `src/**`：契约的唯一事实源分别是看板的
  `src/core/extension.ts` 与 `dsh-ssh` 的 `src/service.ts`，本包在
  `src/core/contract.ts` 同形重述并逐字对齐（含 `launch?.intercept`），跨包协作
  只走 `ctx.inject(['taskBoard'], ...)` 与 `ctx.inject(['dshSsh'], ...)` 的 cordis 服务。
  任一侧改形状时，同一批更新本包的 `contract.ts` 与对应断言。
- 两个服务由同一个依赖作用域同时取：任一侧缺席时本包不登记任何东西，两侧都在时
  才挂上扩展，作用域撤销时整块卸载（`src/index.ts`）。

## 半区分层

- `src/core/`：两侧共享的纯逻辑。`contract.ts`（契约重述与两个 service 解析器）、
  `task-record.ts`、`target.ts`（执行目标与执行记录的线形与校验）、`ledger.ts`（账本
  载荷与裁剪）、`action.ts`（浏览器到宿主的 action 协议）、`shell.ts`（POSIX 转义）、
  `launcher.ts`+`launcher-script.ts`（远端启动器与命令构造）、`adapters/`（四种 agent
  CLI）、`workspace.ts`（工作区策略接口，冻结）。
- `src/host/`：宿主半区。`engine.ts` 是运行引擎（准入、排队、轮询、追问、取消、重启
  对账），`remote.ts` 是远端操作面，`logs.ts` 按字节偏移读日志，`queue.ts` 是每主机
  并发与 FIFO 队列，`payload.ts` 组装账本载荷，`prompt.ts` 是 proxy 前言与续跑提示词，
  `tools.ts` 是三个模型可见工具，`settings.ts` 读配置与唯一的写回路径，
  `workspace/` 是三种工作区机制（`in-place`、`git`+地址、`git`+本机仓库）与
  `layout.ts` 的远端路径/引用派生，`extension.ts` 是看板扩展面，`board.ts` 解析看板
  自己的动作应用器。
- `src/client/`：浏览器半区。`ssh/extension.ts` 登记详情席位、卡片徽标与新建弹窗
  席位，`ssh/detail-section.tsx` 放目标表单、运行状态、日志视图、追问与取消，
  `ssh/compose-section.tsx` 是新建弹窗「执行方式」区块里的目标选择（默认「不指定」，
  未挂载宿主半区时什么都不渲染），`ssh/target-form.tsx` 里的 `SshTargetFields` 是
  上述两处共用的字段集（字段可见性与拒绝文案只有这一份），
  `ssh/log-buffer.ts` 是日志窗口，`ssh/summary.ts` 把执行记录渲染成摘要，
  `ssh/settings-section.tsx` 是看板设置卡里的本扩展区块。

## 远端约定

- 远端只装一个 POSIX `sh` 脚本（`runner-<hash>.sh`）：不依赖 bash、tmux 或 systemd，
  四个动词 `start`/`status`/`tail`/`cancel`，`start` 对 `runId` 幂等。
- 拼进远端命令的每个值都过 `src/core/shell.ts`；新增命令构造不得自行拼接字符串。
- 远端 git 的 `fetch` 与 `push` 在仓库位置前放 `--`（`src/host/workspace/remote-git.ts` 的
  `END_OF_OPTIONS`），卡片给出的仓库地址因此永远落在值位；新增的 git 命令同样不得让卡片
  取值直接进选项位。
- `src/core/target.ts` 的 `parseSshTarget` 拒绝以 `-` 开头的仓库地址与起始分支，且这道闸
  在空白校验之前：git 不会把一张卡片的取值读成选项。
- 态目录是 `<home>/.dsh/task-board-ssh`：`runs/<runId>/` 存一次运行的 spec、prompt、
  stdout/stderr、pid、exit 与 session，`repos/<digest>/` 是每个仓库来源的裸缓存，
  `workspaces/<runId>/` 是按次工作树，`bundles/` 是 bundle 的中转目录。
  git 运行的分支名一律是 `dsh-task/<runId>`。
- 账本载荷不含日志字节：写入前过 `trimSshLedgerPayload`，序列化必须严格低于 64 KiB。
- 适配器的命令行是快照测试的对象；dsh 与 claude 的输出夹具是真实 CLI 录制的，重新录制
  的命令写在 `tests/fixtures/RECORDING.md`。codex 未实机核实，改动时保持这条标注。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-client-ui-task-board-ssh typecheck
pnpm --filter @linxin666/dsh-client-ui-task-board-ssh test
pnpm --filter @linxin666/dsh-client-ui-task-board-ssh build
```
