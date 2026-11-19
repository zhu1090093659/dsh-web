# AGENTS.md — dsh-task-board-ssh

任务看板的外部提供方扩展（把卡片送到经 dsh-ssh 触达的远端主机上执行）。本文件只写本包特有规则。

## 与看板、dsh-ssh 的边界

- 本包不 import 看板或 `dsh-ssh` 的任何 `src/**`：契约的唯一事实源分别是看板的
  `src/core/extension.ts` 与 `dsh-ssh` 的 `src/service.ts`，本包在
  `src/core/contract.ts` 同形重述并逐字对齐（含 S2 的 `launch?.intercept`），跨包协作
  只走 `ctx.inject(['taskBoard'], ...)` 与 `ctx.inject(['dshSsh'], ...)` 的 cordis 服务。
  任一侧改形状时，同一批更新本包的 `contract.ts` 与对应断言。

## 半区分层

- `src/core/`：两侧共享的纯逻辑，本包当前的全部实现都在这里。
  `contract.ts`（契约重述与两个 service 解析器）、`task-record.ts`、`target.ts`（执行目标
  与执行记录的线形与校验）、`ledger.ts`（账本载荷与裁剪）、`action.ts`（浏览器到宿主的
  action 协议）、`shell.ts`（POSIX 转义）、`launcher.ts`+`launcher-script.ts`（远端启动器
  与命令构造）、`adapters/`（四种 agent CLI）、`workspace.ts`（工作区策略接口）。
- `src/index.ts`：host 入口，当前是空操作占位；宿主运行引擎落地时在这里注册扩展。
- `src/client/`：浏览器半区占位。

## 远端约定

- 远端只装一个 POSIX `sh` 脚本（`runner-<hash>.sh`）：不依赖 bash、tmux 或 systemd，
  四个动词 `start`/`status`/`tail`/`cancel`，`start` 对 `runId` 幂等。
- 拼进远端命令的每个值都过 `src/core/shell.ts`；新增命令构造不得自行拼接字符串。
- 账本载荷不含日志字节：写入前过 `trimSshLedgerPayload`，序列化必须严格低于 64 KiB。
- 适配器的命令行是快照测试的对象；dsh 与 claude 的输出夹具是真实 CLI 录制的，重新录制
  的命令写在 `tests/fixtures/RECORDING.md`。codex 未实机核实，改动时保持这条标注。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-client-ui-task-board-ssh typecheck
pnpm --filter @linxin666/dsh-client-ui-task-board-ssh test
pnpm --filter @linxin666/dsh-client-ui-task-board-ssh build
```
