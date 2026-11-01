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

## 探针实例上已取到的真机证据

探针宿主（`DSH_HOME=/tmp/dsh-verify-relay`，profile `probe-relay`）在真机 iPhone 17 上取到：

- 认领：`relay lease: claimed bridge 1d2b31ad49c413fd.relay.chatwithai.icu`
- 出站：`relay bridge: connected`；中继服务重启后 `relay bridge: failed socket closed` 紧跟 `connected`，无需新票据
- 配对：`connection open (device dev_g2ar7f-4dzSbKWps)`，探针设备名册落盘
- 会话流式：手机上看到探针会话的实时增量、工具输出与进行中的工具行

## 剩余两步（宿主重启后）

1. **审批推送**：真实宿主持有 APNs 密钥，探针宿主是 `push: off`，所以这条只能在真实宿主上验。判据：手机在**未打开会话**时收到审批通知；打开会话能看到审批卡，按「允许一次」后宿主侧那次调用被放行。注意 `packages/dsh-remote-bridge/src/index.ts:1858` 那行监听没有 prepend，桌面 GUI 连着时审批会先被桌面接走——验证时把桌面面板关掉。
2. **回滚演练**：删掉上面那两行配置，重启宿主，手机连接地址改回 `wss://<id>.dsh-market.com`，确认三条链路在 dsh-market 中继上继续可用；记录从改配置到手机重连成功的用时，与切换用时一起留档。

## 待清理

探针实例 `/tmp/dsh-verify-relay` 及其进程在灰度收尾后删除；它在真实宿主上还留下一条 `1d2b31ad49c413fd` 的租约行，随 90 天 GC 回收，无需手工处理。
