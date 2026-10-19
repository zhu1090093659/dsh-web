# Agent Note: 聚合家族行直挂真实包

Status: implemented

## Problem

聚合包生成的每个家族行都指向 `@linxin666/dsh-web-all` 的按家族子路径导出，真插件包名放在 `config.plugin`（见[故障隔离 shell](2026-09-01-aggregate-plugin-fault-isolation-shell.zh.md)）。这个形态的代价，直到一个走远程转发的用户实测出来才被量化（issue #1901）。

官方 `dsh-client-modules` 只把包的浏览器半区挂在「`name` 等于包名」的那条 loader entry 上。子路径行不是那条 entry，因此没有任何家族行能自带浏览器半区。聚合包只能把 13 个家族客户端内联进自己的 `./client`：`lib/client.js` 在 0.4.7 是 2,890,548 字节、在 `dev` 是 2,982,246 字节，任何页面都要先把整份文件下载并执行完，才有第一块家族界面。经 EasyConnect/VPN 转发时，这表现为又慢又卡、还伴随 WebSocket 断连；关掉 compat 行页面立刻流畅，同时所有家族面板消失。

随之而来还有三条结构性问题。关掉 compat 行看起来像关掉了家族，因为浏览器半区就住在那里。家族开关只往壳行写 `disabled`，compat 关着时拨了没有可见效果。聚合客户端半区还在浏览器里根据宿主账本（`GET /api/dsh-web-all/rows`，#1372）二次裁决该挂哪些子插件，重复了 loader 已经做过的判断。

## Decision

每个家族行直挂它自己的包：

```yaml
- insert:
    - id: web-ui-task-board
      name: '@linxin666/dsh-client-ui-task-board'
```

`scripts/aggregate.mjs` 直接输出子包自己的包名，loader 因此从该包自己的 entry 下发它的浏览器半区。没有任何东西被内联：`lib/client.js` 只剩 compat 补丁层，22,714 字节；只有启用某一行时，页面才会下载那个家族的界面。行 id 仍是 `web-ui-*`，profile 里已有的逐行覆盖继续命中。

compat 行变成 issue 要的那个东西——只在需要打补丁的场景才开的一层。它保留语义 DOM 钩子（`data-pane` / `data-dsh-frame`）、响应式契约与启动遮罩，并且不再出现在 `LOCKED_ENTRY_IDS`（`packages/dsh-plugin-manager/src/host/state.ts`）：它当初被锁定，是因为停用它会让页面变白而宿主行照旧运行——这个前提已经不成立。

有两套机制失去了存在理由，因此被删除而不是留在原地休眠。活跃行账本（`src/rows.ts`）与 `GET /api/dsh-web-all/rows` 的职责是告诉浏览器半区该挂哪些内联子插件；既没有内联子插件、行状态又归 loader，路由与账本连同客户端挂载门控一起移除。生成的 `children.generated.ts` / `children.specifiers.json` / `children.modules.d.ts` 以及消费它们的 tsdown 源码别名也一并删除。

兼容性只在宿主侧保留。每个原家族子路径（`./settings`、`./task-board` 等）都移进 `tombstones:`，于是本次改动之前写下的 profile——其中行的 `name` 仍是 `@linxin666/dsh-web-all/<family>`——继续解析到 shell 再导出，而不是让整组 boot 抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`。那些老行挂的是 shell，shell 仍认 `config.plugin`；它们只是不会在由新包重新生成的 profile 上再出现。`shell-metadata` 展示资源保留，因为子路径还在，插件列表要读它们的标题与用途说明。

## Alternatives considered

**保留壳，只把 bundle 拆小。** 按家族拆分聚合客户端被否决：loader 每条 entry 只下发一个客户端 bundle，拆分只能在 bundle 内部重新实现成模块系统并不认识的懒加载，浏览器半区仍然由聚合包而不是由拥有它的包下发。

**保留壳行，再为每个家族加一条裸行。** 否决：一个家族两条行意味着两个开关、loader 全局 id 空间里两个 id，以及一个分不清谁说了算的用户。

**为其它消费者保留 rows 路由。** 否决：没有别的消费者。插件管理直接读 profile 的 patch 层，降级账本（`GET /api/dsh-web-all/degraded`）是另一个有自己消费者的面，它保留。

**用 loader 级 supervisor 包装真包来保住故障隔离。** 本仓库做不到，[壳的决策记录](2026-09-01-aggregate-plugin-fault-isolation-shell.zh.md)已经写过；壳只是仓库内的近似实现。

## Consequences

- 家族插件 import 或启动失败会重新回滚 loader 组，这正是壳当初要挡的事。这是 issue 要求的、有意识的取舍：每个页面都背一份全部家族界面，换来的是容纳一次罕见故障，而 loader 的事务式 boot 本就是宿主记载的行为。将来 loader 提供 `continueOnError`，就能在不内联任何东西的前提下恢复隔离。
- 设置面变简单而非变样：家族行现在直接编辑家族包自己的 `Config` schema，而不是壳的 `z.any().volatile()` 替身再转发给 `ctx.plugin()`。包拒绝的字段在写入时就被那份 schema 拒绝——壳从来做不到这一点。
- 插件列表里的行标题来自各个包，而不是 `web-all/<family>`；家族子路径导出与它们的 `shell-metadata` 为仍记录这些名字的 profile 保留。
- 重新把家族客户端内联进聚合 bundle 会静默恢复这笔开销。`scripts/client-bundle-contract.test.mjs` 把 compat 产物钉成「不含 store、不含家族代码」，`packages/dsh-web-all/tests/shell-subpath.spec.ts` 钉住裸行形态与存活的子路径导出。
- `packages/dsh-web-all/lib/client.js` 从 2,982,246 字节降到 22,714 字节（gzip：约 1 MB 降到 7 kB）。家族带来的页面开销现在是「用户启用了哪几行」之和，而不是一份固定的全量副本。

## Testing

`node scripts/aggregate.mjs --check` 钉住生成的 patch；`scripts/aggregate.test.mjs` 断言每个家族行挂的是真实包名且没有壳 config 块、win-bash 的平台守卫逐字保留、profile 可能记录的行 id 与子路径不变。`packages/dsh-web-all/tests/shell-subpath.spec.ts` 断言原家族子路径仍解析到 shell 再导出，`tests/satellite-rows.spec.ts` 断言没有卫星客户端被内联，`scripts/client-bundle-contract.test.mjs` 断言 compat bundle 不消费 client store、不内联任何家族客户端。`pnpm typecheck`、`pnpm test`、`pnpm test:scripts`、`pnpm test:standards`、`pnpm docs:check`、`pnpm i18n:check`、`pnpm emoji:check`、`pnpm libs:check` 与 `pnpm aggregate:check` 全部通过。需要用户重启 `dsh web` 后生效（bundle 层改动）。

## Coverage gap

issue #1901 的测量来自一台经转发的远程页面。本次改动移除了其中占主导的那份副本，但 issue 同时记录的 WebSocket 断连来自上游网关的心跳窗口（`@deepseek-ai/dsh-api-gateway`，2 秒间隔、允许两次错过），不在本仓库范围内。本仓库没有能复现远程转发延迟剖面的通道，因此改进由 bundle 体积与挂载形态验证，而不是重跑那次现场测量。
