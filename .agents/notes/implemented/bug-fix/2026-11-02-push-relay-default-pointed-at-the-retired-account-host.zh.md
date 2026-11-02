# Agent Note: The relay's default address is the account service the App signs into

Status: implemented

## Problem

`RELAY_DEFAULT_URL` 写的是 `https://account.dsh-market.com` —— 那一台曾经担任账号服务的 Cloudflare Worker。App 现在到自建的 `https://account.chatwithai.icu` 领 relayToken，于是站在 relay 路上的桥把票据带去了一个从没签发过它的部署，每一次投递都被拒。2026-11-02 在 local1 上的 `dsh-web` 实测：

- 72 小时日志：**37 次 `401 unauthorized`**、5 次 `relay request failed: TypeError: fetch failed`、**0 次投递成功**。
- 同一枚盘上的票据打两个部署：`POST https://account.chatwithai.icu/v1/push/relay` → `400 invalid_request`（bearer 已通过、只拒 body），`POST https://account.dsh-market.com/v1/push/relay` → `401 unauthorized`。
- 唯一会响的那台机器自己带 APNs 私钥、站在 `direct` 路上，所以从它那边根本看不见这个缺陷：挂载日志写的是 `push: direct`，直连路从不读这个常量。

## Decision

`RELAY_DEFAULT_URL` 改为 `https://account.chatwithai.icu`，`tests/relay.spec.ts` 钉的也是这个地址而不是退役的那个。`DSH_REMOTE_BRIDGE_RELAY_URL` 依然可以把中心挪走，路本身一个字节都没动：[中继投递记录](../architecture/2026-10-30-remote-bridge-push-relay.md) 的决策照旧，只有地址这条事实随本次改动更新。

## Alternatives considered

- **保留默认值，要求每台机器都配变量**：否决。缺变量与配好了长得一模一样 —— 桥照样挂成 `push: relay (https://account.dsh-market.com)`、照样对 `push.register` 答 `ok`，而每一次投递只留一行没人看的日志，正是上面那 72 小时。
- **按顺序试这两个部署**：否决。两条路互斥是刻意的（增量路径上不许 await，且“这条事件去了哪”必须能从一行日志读出来）；退回式尝试会把一个部署的故障伪装成另一个部署的成功。
- **把常量写成部署自己的主机名**：否决。中继存在的意义就是任何桥都能到达那一个代所有人签名的服务；自带部署的桥配变量即可。

## Consequences

- 没有本机 APNs 私钥的桥现在把投递发到签发票据的那个部署，401 停在鉴权步之前。服务端拿到一条已被接受的投递之后做什么，是服务端的事：2026-11-02 用有效票据与全新 session id 实测得到 `{ok:true, delivered:0, dead:0}`，即“已接受、未投出” —— 这是账号服务的事实，不是这个默认值的事实。
- 退役地址仍然可解析、仍然答 `401`，所以被变量钉在旧地址上的部署会继续响亮地失败，而不是悄悄换了服务。
- 本包的 `lib/` 不入库：跑构建产物的宿主需要重新构建才能拿到这个常量，而配了变量的宿主不需要任何动作。
