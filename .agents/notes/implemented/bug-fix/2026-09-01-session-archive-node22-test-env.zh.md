# Agent Note：会话归档测试在 CI Node 22 上变红（node:sqlite 打包 + projcache 写入竞态）

Status: implemented

## Problem

自提交 `c681332b`（把 `dsh-session-archive` 带到 `origin/dev` 的那次合并）起，
`dev` 上每次 CI 都在 `Tests` 步骤失败，`dsh-session-archive` 三个套件报：

```
Error: Cannot bundle Node.js built-in "node:sqlite" imported from
"tests/inventory.spec.ts". Consider disabling environments.client.noExternal
or remove the built-in dependency.
```

`tests/inventory.spec.ts`、`tests/janitor.spec.ts`、`tests/routes.spec.ts`
在 CI（Node 22.23.2）上全部这样失败，而在维护者本机（Node 24/25）通过，
看起来像 CI 独有的幻影失败。CI 常红同时卡住了所有社区 PR（#1329、#1321、
#1306、#1318、#1144）的合并闸门——ruleset 要求全部检查通过。

根因（用便携版 Node v22.23.2 复现验证）：vitest 4 用当前进程的
`module.builtinModules` 构造 vite 每个环境的 `resolve.external` 列表。
Node 22.23.2 上 `node:sqlite` 可以加载，但**不在** `builtinModules` 列表里
（后续 Node 大版本才加入），于是 `node:sqlite` 不会被外置。该包的 vitest
配置把所有 spec 跑在 `jsdom` 环境（client consumer，`noExternal: true`），
vite 8 在 client 环境被要求打包 Node 内建模块时直接报错。Node 24/25 的
`builtinModules` 包含 `sqlite`，所以本机一直是绿的。

在 Node 22 下验证时还暴露了第二个缺陷：环境修复后
`physical delete > removes the directory, ...` 间歇失败（Node 22 上约一半
概率，Node 25 从不失败）。janitor 的 `scrubProjcache` 调用
`writeJsonAtomic` 时没有 await，`deleteSessions` 可能在被清洗的 projcache
索引落盘前就报告成功；而 spec 在调用返回后立即读文件。这是真实的
写/读竞态，只是恰好在 Node 22 的时序下才稳定现形。

## Decision

1. 四个 host 侧 spec（`inventory`、`janitor`、`routes`、`ledger`）用文件级
   `// @vitest-environment node` 覆盖退出 jsdom——与 `dsh-perf` 对它的
   `node:sqlite` spec 已用的模式一致。这些套件跑的是文件系统、SQLite 和
   HTTP server 代码路径，jsdom 没有任何贡献。
2. `scrubProjcache` 改为 async，`deleteSessions` 等待它完成。缓存条目仍然
   是 best-effort（catch 依旧容忍损坏的索引不动它），但删除成功现在保证
   清洗写入先于成功响应落盘。

## Consequences

- CI 的 Node 22.23.2 上 `pnpm -r test` 恢复绿色
  （`dsh-session-archive` 全套 77/77，连续三次运行），Node 24/25 同样通过。
- 删除流程不再与自身的 projcache 清洗竞态；在报告成功之后读取
  `storages/session_projcache.json` 的调用方能确定性地看到清洗后的状态。
- 以后任何包在 vitest spec 里导入 Node 内建模块时，要么声明文件级 node
  环境，要么确认该内建在 CI 的 Node 线（22.x）的 `module.builtinModules`
  里，而不是仅确认"能 import"。

## Alternatives considered

- **弃用 `node:sqlite`，改用 JS 实现的 SQLite**：否决，host 代码确实需要
  Node 内建模块，`dsh-perf` 也已依赖它。
- **在 vitest 配置里给 `node:sqlite` 加 `environments.client.external`
  覆盖**：掩盖真实问题（host 专属 spec 跑在浏览器环境里），且让所有 spec
  继续支付 jsdom 启动成本。
- **把 CI 固定到 `builtinModules` 包含 `sqlite` 的 Node 版本**：拒绝；CI
  的 `node-version: 22` 刻意保持宽泛，测试环境应显式声明，而不是耦合到
  某个 Node patch 版本的内建模块列表。
- **保留 fire-and-forget 写入，让 spec 轮询等文件**：只在测试侧修症状，
  生产侧真实调用方（删除成功后立即读索引）依旧暴露在竞态之下。