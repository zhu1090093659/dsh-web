# AGENTS.md — dsh-ssh

dsh Web GUI 的远程 SSH 运维插件：Host 进程内的持久 ssh2 连接池 + Web GUI 主机
管理面板 / Web 终端 / 文件传输 / 端口转发 / 集群执行，外加 Agent 工具。

## 安全模型（本包最重的纪律）

- 主机配置存 `~/.dsh/dsh-ssh.json`（目录 0700、文件 0600，原子写入）；密码 /
  passphrase 密钥口令以**明文**存在该文件——按 ssh-skill 同一信任模型，别为
  "脱敏"而加密，也别把该路径暴露给模型或日志。
- 连接池空闲 30 分钟自动断开、断线自动重连（最多 3 次）——重连可能**重放非幂等
  命令**，长命令注意副作用（README「已知限制」）。
- exec / cluster 输出**原样返回**（不脱敏），如 `env` 可能把远端环境密钥带回
  对话记录；传输 / 执行消耗**真实远程资源**，Agent 使用前先确认。
- `ssh_upload` / `ssh_download` 以宿主进程权限直接读写本机任意路径（不经
  bash 沙箱）；所有 `/api/dsh-ssh/*` 路由仅限 loopback，隧道只监听 `127.0.0.1`。
- Agent 工具默认全部可用；`defaultPermissionMode` 可设为 `readonly` / `deny` /
  `ask` 收紧模型侧行为（GUI 人工操作不受影响）。改权限语义必须同步 README 与测试。

## Agent 工具面

- 六个工具 `ssh_list` / `ssh_exec` / `ssh_upload` / `ssh_download` /
  `ssh_tunnel` / `ssh_cluster`，GUI 与 Agent 共享同一份主机配置。
- Agent 只能用**用户在 GUI 配置过**（或从 `~/.ssh/config` 导入）的主机；别名
  未配置时先告知用户去 GUI 配置，不得臆造。
- 权限策略只拦截列在 `permissionTools` 中的 Agent 工具；非 SSH 工具不受本包策略影响。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-ssh test   # store + 引擎单测（内嵌 ssh2 Server + 真实 sshd）
pnpm run typecheck
pnpm run build
```
