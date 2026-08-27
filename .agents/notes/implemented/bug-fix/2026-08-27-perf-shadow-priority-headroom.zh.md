# Agent Note: dsh-perf 助手消息 shadow 为第三方替换渲染器预留 priority 保留带

Status: implemented

Supersession check: 现存活跃 Note 中没有归属 assistant-step shadow 契约的记录。[better-session-replaces-chat-recovery](../architecture/2026-08-27-better-session-replaces-chat-recovery.md) 记录了 `@morlay/ui-conversation-message-actions` 的接入，其硬编码 `-1` 的声明正是本次问题的触发点；priority 保留带的决定由本文件从现在起持有。

## Problem

客户端 keyed slot `conversation.chat.node` 对 `(key, priority)` 组合做唯一性硬校验：同 key 同 priority 再注册会抛错，抛错插件整体 apply 失败（报错形如 "keyed slot ... already has an entry ... registered by ..."）。

在 "lowest renders"（最低优先级者渲染）的投影规则下，两个 shadow 渲染器都想占据 key `assistant-step` 的最低位：

- dsh-perf 的 P1 assistant shadow 注册在 `min(已有条目 priority) - 1`；官方默认注册为 0（或尚不存在），因此它计算出 `-1`。
- 外部包 `@morlay/ui-conversation-message-actions@0.0.11` 用硬编码 `priority: -1` shadow 全部十二个 chat-node key。

家族聚合与 better-session 同时加载时，浏览器端 boot 必然失败：两者都精确落在 `(assistant-step, -1)`，谁先注册成功，后到者就整个插件挂掉。

## Decision

dsh-perf 的 assistant shadow 保留"永远低于在场所有条目"的自适应策略，但不再只低一步，而是在当前最小值之下额外下探一段保留带：

```ts
const SHADOW_PRIORITY_HEADROOM = 8
const floor = (existing.length === 0 ? 0 : Math.min(...existing)) - 1 - SHADOW_PRIORITY_HEADROOM
```

官方渲染器为 0 时影子注册在 `-9`；若其他 shadower 先行注册（最小值变为 `-1`），则注册在 `-10`。使用小负数固定值（如今是 `-1`）落位的第三方替换渲染器落在保留带内，永不与影子撞值。此方案与 apply 顺序无关：两种顺序下两包取值都严格相异且影子始终最低。

既有的懒捕获链路不动：entries 按优先级升序排列、捕获跳过自身取次低者，因此挂载了 message-actions 时影子把渲染转发给它的 `AssistantNodeView`，未挂载时转发给官方视图。重负载消息的翻拍逻辑只改 `node.data.status`，它流入下一个实际渲染的捕获组件——"全部输出经生效中的下游渲染器"这一视觉契约不变。

## Alternatives considered

- **固定一个很大的哨兵值**（如 `-1000`）：否决——完全放弃自适应推导，且若别的插件照抄同一哨兵思路仍会互相撞值。
- **检测到其他低优先级占用者就放弃注册**：否决——在场检测依赖注册顺序（影子可能先于 message-actions apply 而看不到对方），yield 会随启动顺序静默抖动。
- **装了 better-session 就停用 perf shadow**：否决——priority 错开后二者本可组合（影子先改 status、再由 message-actions 的渲染器出画）；停用会让重会话失去错峰翻转队列。
- **通过聚合 harness 行给 morlay 包的硬编码 `-1` 打补丁**：否决——不为外部 npm 包携带本地覆盖；该值归上游所有，fork 会立即漂移。

## Consequences

- 家族全量 bundle 加 better-session 时浏览器端加载恢复正常；两包对 chat-node 的声明不再存在任何 `(key, priority)` 冲突。
- 保留带宽为 8；将来若有第三方替换渲染器硬编码低于 `-9` 的值仍会撞值。届时加宽 `SHADOW_PRIORITY_HEADROOM` 即可；报错信息会同时点名两个注册方，是现成的定位入口。
- 两层叠加意味着超重助手消息经双重转发渲染（shadow -> AssistantNodeView -> 官方子组件）。若有视觉差异，来源是 message-actions 自身而非 dsh-perf。
- message-actions shadow 的其余十一个 key（`user`、`context`、`command` 等）除官方渲染器（0）外在本 profile 树内没有第二个声明者；本修复之后不存在其他冲突组合。

## Testing

- `packages/dsh-perf`：`pnpm typecheck` 通过、`pnpm test` 40/40 通过，tsdown 已重建 lib 并经 profile 链接即时生效。
- 通过 grep 全部 `~/.dsh/profiles` 树（跟随符号链接）重推冲突清单：只有官方 conversation（0）、dsh-perf（保留带）、morlay message-actions（-1）贡献条目。
- 运行态确认需要用户刷新/重启 `dsh web`；上述静态证据保证不再有任何等值组合。
