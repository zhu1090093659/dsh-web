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
- `proxyCommand` 是由宿主进程以其权限执行的 shell 命令（与 `ssh(1)` 执行同一行的
  信任模型）：只来自用户 0600 配置文件；agent 工具只暴露是否配置、不暴露命令原文，
  agent 也不能创建 / 修改主机；POSIX 按进程组回收子进程，Windows 只杀 shell
  （已知限制）。
- Agent 转发（`forwardAgent`）按主机选择性启用、默认关闭：启用后远端可以**以本机身份**
  用本机密钥完成认证，这类信任只能由用户在 GUI 里逐台给出。本地端点（主机配置的 agent
  路径 → `SSH_AUTH_SOCK` → Windows 原生 OpenSSH 命名管道）必须解析出结果，解析不出就
  **报错掉线**，不能悄悄不转发；服务端拒绝该请求时必须把服务端错误原样抛出，禁止降级成
  未转发的会话。README「安全模型」是这条的用户侧表述。
- `agentPath` **不是机密**（它是地址串，不是凭据）：留空表示自动检测，任何情况下都要照常
  提交。主机表单里只有密码与私钥路径走「编辑时留空即保留旧值」的规则——把 agent 路径也
  当 secret 会让 PATCH 丢掉整个 `auth` 块，静默保留旧的认证方式（#1910）。
- 跨插件服务 `dshSsh` 是**宿主进程内的能力面，不是网络面**：装载进本宿主的任何插件都能
  经它执行远程命令、传输文件，可达范围与 `ssh_*` 工具相同，没有按消费方的权限分级。
  它只交出主机的公开字段，`proxyCommand` 原文与任何凭据永不外露；纪律见下节「宿主服务
  dshSsh」。

## Agent 工具面

- 六个工具 `ssh_list` / `ssh_exec` / `ssh_upload` / `ssh_download` /
  `ssh_tunnel` / `ssh_cluster`，GUI 与 Agent 共享同一份主机配置。
- Agent 只能用**用户在 GUI 配置过**（或从 `~/.ssh/config` 导入）的主机；别名
  未配置时先告知用户去 GUI 配置，不得臆造。

## 宿主服务 dshSsh（跨插件复用）

- 服务面唯一事实源是 `src/service.ts`：`DSH_SSH_SERVICE` / `DSH_SSH_API_VERSION`、服务类型
  与 `declare module` 都在这一份 import-free 文件里。消费方包**同形重述**它并按服务名
  取值，禁止 import 本包 `src/**`；也不为某个消费方在服务面加特例成员。
- 服务面是 `SshEngine` 的薄转发，成员固定为 `apiVersion`、`hosts.list()`、
  `hosts.find(alias)`、`exec`、`upload`、`download`：不复制引擎逻辑，不加流式、目录树、
  终端、隧道或集群成员。需要新的引擎能力先加进引擎，再由服务面转发。
- 服务面不交出机密：`hosts.*` 只给 `SshHostSummary` 已公开的字段，`proxyCommand` 原文
  投影掉（与 `ssh_list` 同一规则），密码 / 口令 / 私钥路径 / agent 路径永不出现；
  `tests/service.test.ts` 逐字段钉住这条。
- 发布时机跟随总开关：在 `sync()` 里与其它面同批 `ctx.provide`、同批撤走，停用或卸载即
  释放依赖方的 inject 作用域。不得改成无条件提供，也不得绕过 `sync()` 常驻。

## 面板与终端会话

- client 半区经官方槽位注册**原生中栏面板**：`native-panel.tsx` 往 shell 自己的
  面板列表（`sidebar.panellist`）贡献一行、往布局的 keyed `main` 槽贡献页面，
  并驱动 `ctx.layout.selectPanel`——与任务看板、技能中心同形，行盒 / 标签 /
  高亮 / 折叠轨道归 shell，本包不再 DOM 接管中栏。
- 页签、hosts 页的「连接」请求与**终端会话 id** 存在 `panel/controller.ts`：
  布局只在面板被选中时挂载页面，组件本地 state 会在切面板时丢失。
- **PTY 会话归 Host**（`src/engine/terminal-sessions.ts`）：会话按 id 存活，
  视图卸载只 detach、重新挂载按 id reattach 并回放滚动缓冲；只有显式
  `close` 帧、远端退出后的宽限期到期或空闲回收才结束会话。路由层只做
  loopback 围栏与 socket 接线，会话表随路由注销一并 dispose。
- **终端多标签（#1950）**：标签与其状态（alias / host session id / status / 待答
  2FA / 关闭失败）都存 `panel/controller.ts`，视图只保留**一个 xterm**，切 tab 是
  重绑这一个终端而不是叠终端。切走已 ready 的标签只 detach，切回按 sessionId
  attach 回放。
- **ready 之前不得 detach**：此时没有 sessionId 可回连，丢掉 socket 等于把 Host
  上的 connecting 会话晾成无人认领的孤儿 PTY（参考实现在这里的缺陷）。连接交给
  controller 的 `adoptTerminalLink`，拿到 id 后按意图 detach 或 close；
  `reclaimTerminalLink` 让切回的标签复用同一条连接，不重复开 PTY。
- **意图在 ready 时现读**：`adoptTerminalLink` 的 onReady 必须从当时的登记项读取
  intent，不能沿用认领闭包里的值；关闭仍在连接的标签时 `closeTerminalTab` 把意图
  改成 close（而不是丢弃登记项），否则 ready 之后仍会 detach，留下无主 PTY。
  视图里 tab 已不存在且未 ready 的 socket 同样以 close 兜底。
- **认领期间不丢输出**：adopt 期间 `onOutput` 写入该标签保留画面，取回 socket 时先
  画出来再继续写入；每次绑定（新开 / 切回 / exited 重绘）都要先按"这块屏当前属于别的
  标签"清屏，否则会串台。
- **2FA 答案按标签隔离**：挑战与答案（`authPrompt` / `authAnswers`）都存标签记录，
  后台挑战不得清当前输入，提交只发当前标签自己的答案；视图不持有答案状态。
- **远端 exit 只清 sessionId**：标签、位置与最后一屏输出保留，不得删标签，也不得
  让 placeholder 盖住画面；只有"没有任何标签"时终端区才显示 placeholder。
- **关闭后台标签**走 `api.closeTerminalSession`：短暂 attach 后发 `close` 帧，
  不新增 HTTP 路由。判定是"会话是否已不在运行"：帧落到已 OPEN 的 socket，或 Host 回
  `exit`（未知 id 回 `terminal session expired`）都算已关闭；socket 报错、打开前
  关闭、或在有界等待（默认 5s）内无结论则算未证明，保留标签与 sessionId 并报
  `closeError`，不得谎称已关闭。同一标签同时只允许一次关闭尝试（in-flight 防重）；
  恢复语义是"重试"或"把该标签切到前台用其自身 socket 关闭"，陈旧 `closeError` 在
  ready / exit / fail 时清除，绝不因为关不掉就静默移除标签。
- **终端 socket 走外壳公布的 Host**（`src/client/api.ts` 的 `terminalSocketUrl`）：
  应用交付的页面（桌面版 `dsh-app://app/`）不能在自己的 scheme 上升级 socket，
  但外壳已经通过官方钩子 `__DSH_TRANSPORT__.streamBaseUrl` 公布它拥有的 Host
  authority 并改写该 Host 的握手，因此在这种页面上改拨该地址（仅当它是可解析、
  无 userinfo、authority 非空的 http(s) origin）。网页始终按自身 origin 解析——
  远程通道会把 `ownsHost` 授予已配对的局域网页面，那类页面必须继续留在门控通道里。
  宿主侧围栏不变，socket 仍走 loopback。决策与被取代的旧方案见
  `.agents/notes/implemented/bug-fix/2026-10-02-ssh-terminal-dials-shell-owned-host.md`。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-ssh test   # store + 引擎单测（内嵌 ssh2 Server + 真实 sshd）
pnpm run typecheck
pnpm run build
```
