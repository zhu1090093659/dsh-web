# AGENTS.md — dsh-diagrams

DSH Web GUI 的 mermaid 图示渲染插件。包级规则只写本包特有约定，不重复根 AGENTS.md 与
packages/AGENTS.md 的全局规则。

## 本包要点

- **唯一接入点是官方渲染器的 DOM，不是契约**：官方 markdown 渲染器没有代码块扩展缝，
  所以本包观察 `div.md-code-block` 并从 banner 的 infostring 文本读围栏语言。这些名字
  全部集中在 `src/core/contract.ts`，旁边 `tests/contract.spec.ts` 把它们钉住；宿主
  升级后改名的唯一表现是「图不渲染、围栏退回代码块」，不会抛错。钩子的来历与代价见
  Agent Note `.agents/notes/implemented/architecture/2026-11-03-diagram-renderer-dom-contract.md`。
- **只渲染 mermaid**：其它围栏语言一律不碰；扩展其它图 DSL 是新的工作项，不要在这里
  顺手加分支。
- **原代码块只隐藏、不删除**：渲染成功后 `<pre>` 置 `display:none`，宿主的复制按钮
  仍从它取源码。渲染失败必须 `restoreBlock` 把块恢复原状（清认领戳、清 display）。
- **失败即回落，绝不抛错到调用方**：运行库缺失、语法错误、半截围栏都走同一条回落路径；
  流式期间靠下一批 DOM 变更重试。
- **不用槽位、不注册服务**：浏览器半区只有一个 `ctx.effect` 启动观察器；宿主半区只有
  一条只读 vendor 路由（`ctx.webServer.register`，走共享 `pair-access` 围栏）。
- **vendor 资产是构建产物**：`lib/assets/mermaid.min.js` 由 tsdown 的 `copy` 从
  `node_modules/mermaid/dist` 复制，不进 git、不进客户端 bundle；缺失时路由 404、页面
  静默回落。
- **SVG 二次消毒不可省**：mermaid 的 strict 等级之外仍要剥 `script`/`foreignObject`/
  `on*`/`javascript:`；清理后仍可疑就抛错走回落，绝不注入。
- **语义属性**：容器打 `data-dsh-plugin="diagrams"` 与 `data-dsh-part="diagram"`；
  枚举值在 dsh-skins 的 `contracts/semantic-attrs-v1.md` 登记。
- 共享件副本：`src/mount-once.ts`、`src/host/loopback.ts`、`src/host/pair-access.ts`
  由 `scripts/sync-shared.mjs` 生成，禁止手改。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-client-ui-diagrams typecheck
pnpm --filter @linxin666/dsh-client-ui-diagrams test
pnpm --filter @linxin666/dsh-client-ui-diagrams build
```
