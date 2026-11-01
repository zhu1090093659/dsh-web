# 传输面搬到自建中继：切换交接

自建中继已上线，探针实例上的配对与会话流式在新路径通过。真实 desktop profile 已改为指向新中继，等待宿主重启生效。本文只记切换这一刻的状态、证据与剩余两步，设计见 [自建中继会合点](../.agents/notes/proposed/architecture/2026-11-01-selfhosted-relay-meeting-point.md)。

## 已就位

| 对象 | 事实 |
| --- | --- |
| DNS | `relay.chatwithai.icu` 与 `*.relay.chatwithai.icu` 两条灰云 A 记录指向 43.153.135.11 |
| 证书 | `/etc/letsencrypt/live/relay.chatwithai.icu/`，SAN 为 `relay.chatwithai.icu` 与 `*.relay.chatwithai.icu`，到期 2027-01-30，certbot 已排自动续期（dns-cloudflare，凭据在 `/etc/cloudflare/credentials.ini`） |
| 服务 | systemd 单元 `whale-relay-go.service`，二进制 `/opt/whale-go/relay/whale-relay`，监听 127.0.0.1:18789，环境文件 `/opt/whale-go/relay/relay.env`，库 `/var/lib/whale-go/relay.db` |
| 反代 | `/etc/nginx/sites-available/whale-relay`，server_name 两条，Host 原样透传，升级头走既有 `$whale_connection_upgrade` |
| 桌面 profile | `~/.dsh/profiles/desktop/cordis.patch.yml` 的 `web-ui-remote-bridge` 行新增 `relayControlUrl: https://relay.chatwithai.icu/v1/relay` 与 `relayPublicSuffix: .relay.chatwithai.icu`，备份为同目录 `.bak-relay-cutover-*` |

## 切换实测

真实宿主重启后服务器侧原始记录：

```
13:38:15 lease claimed  instance=8957f5eb13560cdc plugin=0.4.13 refreshed=false
13:38:15 connector attached instance=8957f5eb13560cdc replaced=false
13:39:35 connector read failed 1006 -> connector detached
13:39:37 lease claimed  refreshed=true
13:39:38 connector attached
```

- 公网地址：`wss://8957f5eb13560cdc.relay.chatwithai.icu`（沿用原有中继 id，只换后缀）
- 断线到重连：13:39:35 到 13:39:38，3 秒，无需新票据
- 三条链路在真实宿主上通过：配对（设备名册落盘）；会话流式（手机看到实时增量、工具输出与进行中状态）；审批/提问卡（手机底部弹出「Waiting on you」，宿主那次调用在等它作答）

## 探针实例上已取到的真机证据

探针宿主（`DSH_HOME=/tmp/dsh-verify-relay`，profile `probe-relay`）在真机 iPhone 17 上取到：

- 认领：`relay lease: claimed bridge 1d2b31ad49c413fd.relay.chatwithai.icu`
- 出站：`relay bridge: connected`；中继服务重启后 `relay bridge: failed socket closed` 紧跟 `connected`，无需新票据
- 配对：`connection open (device dev_g2ar7f-4dzSbKWps)`，探针设备名册落盘
- 会话流式：手机上看到探针会话的实时增量、工具输出与进行中的工具行

## 回滚实测

配置在 13:44:59 删除，宿主 13:46:33 退出、13:46:41 起来，手机改回 `wss://8957f5eb13560cdc.dsh-market.com` 后连上，协议日志记到 `LINK dial ... ready=227ms` 与 `SEND hello`（capability 里含 `approvals.v1`）。端到端 1 分 42 秒里，宿主自身重启占 8 秒，其余是排的重启延时。

## 回滚与再切换

回滚只动一个文件：`~/.dsh/profiles/desktop/cordis.patch.yml` 里 `web-ui-remote-bridge` 行的 `config:` 两行，删掉后重启宿主，手机连接地址改回 `wss://8957f5eb13560cdc.dsh-market.com`。

再切回新中继用备份覆盖：

```sh
cp ~/.dsh/profiles/desktop/cordis.patch.yml.bak-relay-cutover-* ~/.dsh/profiles/desktop/cordis.patch.yml
```

覆盖后重启宿主，手机地址改回 `wss://8957f5eb13560cdc.relay.chatwithai.icu`。配置生效点只在宿主重启，手机侧只是改一个 origin，两个方向都不需要动 dsh-market 的中继行。

已知边界：`packages/dsh-remote-bridge/src/index.ts:1858` 对 `approval/request` 的监听没有 `prepend`，桌面 GUI 连着时审批会先被桌面接住，手机可能收不到卡；这与走哪个中继无关。

## 待清理

探针实例 `/tmp/dsh-verify-relay` 及其进程在灰度收尾后删除；它在真实宿主上还留下一条 `1d2b31ad49c413fd` 的租约行，随 90 天 GC 回收，无需手工处理。
