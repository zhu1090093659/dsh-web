# Agent Note: 以 ProxyCommand 作为 SSH 传输层（issue #1448）

Status: implemented

## Problem

dsh-ssh 此前只能直连 TCP，或经由本插件中已配置别名的 ProxyJump 链到达主机。只能通过 OpenSSH `ProxyCommand` 到达的主机——企业堡垒机客户端代连目标（`corp-vpn proxy %h %p %r`）、`ssh -W %h:%p jump`、`cloudflared access ssh`、`aws ssm start-session`——完全不可用，而 `~/.ssh/config` 导入器会静默丢弃该指令，于是导入看起来成功、主机却永远连不上。同一份报告还带来三个导入缺口：从不读取 `Include` 文件、跳过没有 `HostName` 的块（OpenSSH 会把 Host pattern 本身当主机名）、`ProxyJump ops@bastion:2222` 这种地址形式虽然被存下来却永远解析不了。导入结果只有一个跳过计数，这些问题都不可见。

## Decision

`proxyCommand` 成为存储的主机字段，命令的 stdio 就是连接传输层。

### 传输层

`startProxyCommand()` 通过用户 shell 启动命令（POSIX 用 `$SHELL -c`，Windows 用 `cmd.exe /d /s /c` 并采用 Node 自身的原样引用配方），展开 OpenSSH token（`%h` 主机、`%p` 端口、`%r` 用户、`%n` 别名、`%%` 字面百分号），并把 stdin/stdout 桥接成 `Duplex` 交给 ssh2 作 `sock`。ssh2 把外部传入的 socket 视为已连接，因此 exec、Web 终端、SFTP、隧道与集群执行都自动复用该传输层，无需第二条连接路径。

失败语义由传输层自己承担，而不是交给 ssh2 的 `readyTimeout`：spawn 失败、或握手前进程退出（附带命令 stderr 尾部）都会带退出状态销毁流；销毁流会杀掉进程——POSIX 上杀整个进程组，`ssh -W %h:%p bastion` 不会残留客户端。只有在进程成功退出后才报告干净的 EOF，否则 ssh2 那句笼统的 "connection lost before handshake" 会盖住真实原因。

### 组合规则

- 同一主机上 `proxyCommand` 与 `proxyJump` 互斥，创建、导入、以及 PATCH 的「叠加后视图」都要校验（给已有一种传输的主机补另一种会被拒绝）。OpenSSH 按「配置中先出现者生效」解析，而存储条目没有先后顺序，任选其一都是武断的。
- 链式跳板中，某一跳自己的 `proxyCommand` 就是到达该跳的传输层，且只在第一跳生效。后续跳声明 ProxyCommand 直接报错而不是静默降级；因此「经堡垒机中转」的正确做法是把堡垒机配置成带自己 `proxyCommand` 的主机条目，再跳它。
- 不是已配置别名的跳板值按 OpenSSH 的 `[user@]host[:port]` 地址解析（IPv6 用方括号），并复用目标主机的认证，因为临时跳板没有自己的凭据。跳板连接与转发错误都会带跳板 spec 与解析后的地址前缀，拼错也能定位。

### 导入

解析器移到 `src/ssh-config.ts`：`Include` 原地展开（glob、`~`、多路径、相对被导入配置所在目录，深度上限并对 realpath 去重，因此菱形包含不会重复），`Match` 块记录一条跳过并结束上一个块（此前其选项会被并入上一个 Host 块），缺失 `HostName` 时回退到 pattern，`ProxyCommand none` 被丢弃。`ImportResult` 现在返回 `skippedBlocks: { name, reason }[]`，原因为 `wildcard | existing | match | invalid`，主机页把它们渲染在导入提示下方。

### Agent 面

`ssh_list` 报告 `proxyCommandConfigured: boolean` 而不是命令原文：该值可能内嵌堡垒机凭据，模型只需知道这台主机走代理。Agent 依旧不能创建或修改主机，因此也无法引入命令。

## Alternatives considered

- 同时允许两种传输并叠加（ProxyCommand 作为种子，再在其上跑跳板链）。否决：种子命令的 token 绑定的是目标主机、而实际连接的是第一跳，语义无法自洽，OpenSSH 本身也从不叠加两者。
- 导入时把地址形式跳板物化成存储条目。否决：会往用户主机列表塞机器生成的别名，还要额外定义命名与冲突规则，收益为零。
- 忽略非首跳的 `proxyCommand`。否决：静默丢弃用户配置的传输层，正是本 issue 报告的失败模式。
- 跳板 spec 解析不出时回退到目标主机（旧行为）。否决：那会把拼写错误藏在对错误机器的连接后面。
- 把 ProxyCommand 原文暴露给 `ssh_list`。因上述凭据泄漏风险否决。

## Consequences

- 经 API 修改 `proxyCommand` 会像其它连接字段一样断开该别名的池化连接。
- Windows 上只杀 shell、不带进程组，命令拉起的客户端可能比传输层存活更久；已记为已知限制。
- 地址形式跳板继续使用目标凭据：需要独立密钥或用户的跳板必须配置成主机条目，README 已说明。
- GUI 目前无法清空 `description` / `environment` / `location`（省略键表示「保持不变」，而表单发送的是 `undefined`）；`proxyCommand` 通过发送显式空串规避了这一点。同组字段仍是未修的独立缺口。

## Testing

- `tests/ssh-config.test.ts`：Include glob 字典序、缺失 include、Match 上报、大小写不敏感键、顶层文件缺失。
- `tests/proxy-command.test.ts`：token 展开表、双向 stdio 桥接、destroy 回收子进程、命令失败时的退出状态与 stderr、命令无法启动。
- `tests/connection-pool.test.ts`：条目 ProxyCommand 作为 ssh2 的 `sock`、地址跳板解析并复用目标凭据、跳板错误带跳板名、非首跳 ProxyCommand 被拒、两种传输并存被拒、`parseJumpSpec` 表。
- `tests/engine.test.ts`：在故意不可达的 HostName 上，用 ProxyCommand 桥接 stdio 到内嵌 ssh2 服务器跑通 exec；`dropAlias` 同时回收池化连接与命令；失败命令给出自身错误而非握手超时。
- `tests/store.test.ts` 覆盖校验、PATCH 叠加与导入原因；`tests/routes.test.ts` 覆盖传输层变更触发连接池失效。
