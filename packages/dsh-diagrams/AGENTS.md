# AGENTS.md — dsh-diagrams

DSH Web GUI 的 mermaid 图示渲染插件。包级规则只写本包特有约定，不重复根 AGENTS.md 与
packages/AGENTS.md 的全局规则。

## 本包要点

- **主路径走官方 `conversation.chat.markdown.fence` 槽位，DOM 观察仅作兜底**：聊天正文里经
  `ctx.slots.inject` 向官方 `conversation.chat.markdown.fence` hoc 槽（`key: 'mermaid'`，
  组件 `MermaidFenceLayer.tsx`）注册渲染层；不传 `renderCode` 的 Markdown 视图（如文档预览
  面板）回落到作用域 DOM 观察器（观察 `div.md-code-block` 并从 banner 读围栏语言，显式跳过
  已落在 `[data-slot="conversation.chat.markdown.fence"]` 内的块）。DOM 兜底使用的选择器与
  槽位常量集中在 `src/core/contract.ts`，旁边 `tests/contract.spec.ts` 把它们钉住；宿主
  升级后改名的唯一表现是「图不渲染、围栏退回代码块」，不会抛错。钩子的来历与代价见
  Agent Note `.agents/notes/implemented/architecture/2026-11-03-diagram-renderer-dom-contract.md`。
- **只渲染 mermaid**：其它围栏语言一律不碰；扩展其它图 DSL 是新的工作项，不要在这里
  顺手加分支。
- **原代码块只隐藏、不删除**：DOM 兜底路径渲染成功后 `<pre>` 置 `display:none`，宿主的复制
  按钮仍从它取源码；渲染失败必须 `restoreBlock` 把块恢复原状（清认领戳、清 display）。
  槽位路径渲染失败或无运行时回落到原始代码围栏渲染。
- **失败即回落，绝不抛错到调用方**：运行库缺失、语法错误、半截围栏都走同一条回落路径；
  流式期间靠下一批渲染/DOM 变更重试。
- **可选依赖 `slots`、不注册服务**：浏览器半区声明 `slots: { required: false }`，在 `slots`
  可用时挂官方围栏层并始终启动兜底观察器；宿主半区只有一条只读 vendor 路由
  （`ctx.webServer.register`，显式声明 `auth: 'anonymous'`，走共享 `pair-access` 围栏）。
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
