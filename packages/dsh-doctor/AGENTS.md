# AGENTS.md — dsh-doctor

DSH Web GUI 插件 @linxin666/dsh-doctor（救助模式）。包级规则：只写本包特有约定，
不重复根 AGENTS.md 与 packages/AGENTS.md 的全局/包级规则。

## 本包要点

- 三区分层：`src/index.ts` 是 host 半区（插件自身 Config 即设置面、loopback 路由、心跳）；
  `src/client/` 是 browser 半区（Web 插件组内的 Doctor 设置卡片：启用/策略开关 + 嵌入式恢复控制台、故障探针）；`src/core/` 是
  两侧共享纯逻辑（协议、profile 身份、快照、修复规则引擎）；`src/agent/` 是
  Supervisor / Launcher / 旧服务清理 / 救援胶囊（Node 专用）；`src/cli.ts` 是
  `dsh-doctor` CLI 入口（tsdown companion 构建）。
- **不改 DSH**：profile 的 package.json 与 cordis.patch.yml 只经官方 `dsh plugin`
  命令修改；诊断与修复在候选隔离环境执行。
- **安全边界**：所有 supervisor IPC 经本地 socket（或命名管道）+ 0600 token；
  `/api/doctor/*` 路由必须经 shared/host/loopback.ts 的 `isLoopbackRequest`
  门禁；状态、日志、事件与快照不落密钥（凭据脱敏）。
- **确定性修复**：修复动作来自版本化规则（`src/core/`），不依赖 LLM；歧义只产
  生候选等待确认；修复/回滚日志追加写盘并支持崩溃恢复。
- **共享件副本**：`src/mount-once.ts`、`src/host/loopback.ts` 由
  `scripts/sync-shared.mjs` 生成，禁止手改。
- **宿主受管子进程**：Supervisor 由宿主拉起并带父进程存活监视（`--parent-pid`），
  禁止注册任何 OS 级后台服务（LaunchAgent / systemd / 计划任务一律不得复活）；
  `service-uninstall` 只做旧版注册的一次性清理。
- 测试必须覆盖：协议解析、profile 身份、Supervisor 状态机与熔断、Launcher 参数
  归类、父进程存活监视、loopback 门禁、修复事务与回滚、客户端故障探针。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-doctor typecheck
pnpm --filter @linxin666/dsh-doctor test
pnpm --filter @linxin666/dsh-doctor build
```
