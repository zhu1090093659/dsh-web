# dsh-ssh — 远程 SSH 运维插件（DSH 版 ssh-skill）

[English](README.md) | 中文

基于 [badseal/ssh-skill](https://github.com/badseal/ssh-skill) 的能力清单，为 DeepSeek Harness（DSH）定制的远程 SSH 插件：Host 进程内的持久连接池 + Web GUI 主机管理面板 + Web 终端 + Agent 工具，全部通过官方 NPM SDK 实现，不修改 DSH 源码。

## 能力

| 能力 | 说明 |
| --- | --- |
| 主机管理 | 增删改查、搜索、连接测试；支持按环境 / 标签分组折叠与组内批量测试；配置存 `$DSH_HOME/dsh-ssh.json`（默认 `~/.dsh/dsh-ssh.json`）；支持密钥 / 密码 / ssh-agent 认证（OpenSSH agent / Pageant）、passphrase 密钥、ProxyJump 跳板机（多级） |
| 配置导入 | 一键解析标准 `~/.ssh/config`（Host/HostName/User/Port/IdentityFile/IdentityAgent/ProxyJump 等），已有别名自动跳过 |
| 持久连接池 | 每台主机复用长连接（对应 ssh-skill 的守护进程），空闲 30 分钟自动断开，断线自动重连（最多 3 次） |
| 命令执行 | exec 带超时（默认 60s），stdout/stderr 分离，输出截断保护（2MB） |
| Web 终端 | xterm.js + WebSocket PTY 终端，自适应尺寸，实时输出 |
| 文件传输 | SFTP 上传（浏览器选文件，NDJSON 进度流）、下载（进度条 + 浏览器保存）；远程目录浏览 |
| 端口转发 | 本地端口转发隧道（仅监听 127.0.0.1），访问远程数据库 / 内网服务，支持列表 / 停止 |
| 集群执行 | 一条命令并发跑多台主机（按别名 / 环境 / 标签过滤，默认并发 8） |
| Agent 工具 | `ssh_list` / `ssh_exec` / `ssh_upload` / `ssh_download` / `ssh_tunnel` / `ssh_cluster`，GUI 与 Agent 共享同一份主机配置 |

## 安全模型

- 所有 `/api/dsh-ssh/*` 路由仅限 loopback 访问（含同源校验）——对远程服务器执行命令的接口不会暴露给局域网。
- 密码 / 密钥口令以明文保存在 `$DSH_HOME/dsh-ssh.json`（默认 `~/.dsh/dsh-ssh.json`），文件权限 0600、目录 0700（与 ssh-skill 把密码写进 ssh-config 注释同一信任模型）。
- ssh-agent 认证仅保存 agent socket 路径（或 `pageant` 特殊值），不读取也不保存任何私钥材料。
- 隧道只监听 `127.0.0.1`。
- 删除主机或修改其连接字段（host / port / user / auth / proxyJump）会立即断开该别名的池化连接与隧道，后续操作按新配置重新建连，不会复用旧凭据的已认证连接。
- Agent 使用工具前，主机需先在 GUI 中配置（或从 ~/.ssh/config 导入）。
- `ssh_upload` / `ssh_download` 以宿主进程权限直接读写本机任意路径（不经 bash 沙箱）——与 ssh-skill 的宿主本地路径语义一致，注意该权限面。
- exec / cluster 的远程输出原样返回（不脱敏），命令如 `env` 可能把远端环境中的密钥带回对话记录。

## 安装

推荐直接安装全家桶聚合包 `@linxin666/dsh-web-ui-all`（一个包装齐全部功能插件与皮肤），或单独安装本插件：

```sh
### 从 npm 安装（推荐）
dsh plugin --profile web add @linxin666/dsh-ssh@latest

### 从仓库安装（开发调试）
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-ssh

```

安装后**重启 `dsh web`**：侧边栏出现「SSH」入口；Agent 提示词中自动出现插件说明。

## 配置

设置面板（插件配置）可开关 `announceToAgent`（是否向 Agent 宣告插件；默认关闭，保持系统提示词干净）与 `enabled`（总开关），并可设置 `terminalFontFamily`（Web 终端字体，留空则按 CSS 链解析：`--dsh-ssh-terminal-font` → 官方 `--ds-font-family-code` token → 内置 monospace 栈）。终端字体写死在 xterm 构造参数里，CSS 无法直接覆盖；要渲染 powerline / Nerd Font 图标，请在此填入对应 Nerd Font 栈（如 `"SauceCodePro Nerd Font", monospace`），修改对已打开的终端即时生效，无需重连。

## 数据

- 主机配置：`$DSH_HOME/dsh-ssh.json`（默认 `~/.dsh/dsh-ssh.json`；版本化 JSON，原子写入）
- 传输暂存：`os.tmpdir()/dsh-ssh-uploads/`（目录 0700，传输中的文件 0600）

## 开发

```sh
pnpm install --filter @linxin666/dsh-ssh...
pnpm --filter @linxin666/dsh-ssh test    # 单测：store + 引擎（内嵌 ssh2 Server + 真实 sshd）
pnpm --filter @linxin666/dsh-ssh build   # tsc 类型 + tsdown 双半区产物
```

## 已知限制

- 上传的远程目标路径必须是绝对路径（相对路径会被拒绝）。
- 下载暂不支持整个目录（逐文件下载）；上传支持目录递归（walk 本地目录逐文件传）。
- exec 断线自动重连（最多 3 次）可能重复执行非幂等命令——长命令注意副作用。
- 跳板机 ProxyJump 的每一跳必须是本插件已配置的主机别名。
- 断点续传（resume）暂未实现。
- Agent 工具的传输为宿主机器本地路径（与 ssh-skill 相同的语义）。
