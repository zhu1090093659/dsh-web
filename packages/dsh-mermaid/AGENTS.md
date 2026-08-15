# AGENTS.md — dsh-mermaid

DSH web GUI plugin dsh-mermaid. 包级规则：只写本包特有约定，不重复根 AGENTS.md 与
packages/AGENTS.md 的全局/包级规则。

## 本包要点

- 把助手消息中的 mermaid 围栏渲染为 SVG 图表。SDK 没有围栏渲染槽位，增强走
  DOM 层：`src/client/enhancer.ts` 观察会话 DOM，匹配 primitives CodeBlock 的
  `div.md-code-block` 结构（banner infostring 为 `mermaid`）。shell 改 CodeBlock
  标记时需同步 `findMermaidFences` 的结构契约（测试有对应夹具）。
- React 互操作铁律：不删改 React 拥有的节点（banner、源码 body）；figure 只作为
  block 的额外尾子节点插入，隐藏源码用 data 属性 + 自有样式表，任何一步失败都
  降级为不增强，绝不抛错（shell 会因 apply 抛错而整体启动失败）。
- mermaid 库整体打包进 client 产物（约 2 MB），`src/client/mermaid-runtime.ts`
  是唯一 import 点；测试永远不 import 它（走 enhancer 的 render 注入缝）。
- 主题表与 normalize 逻辑在 `src/core/themes.ts`（两侧共享纯逻辑）；client 严禁
  import host 半区 `src/index.ts`（会拖入 dsh-settings 值导入，破坏浏览器 bundle
  纯度门）。
- host 半区只注册 `mermaid` 设置命名空间（enabled + theme）；apply 不做加载时
  校验（聚合行无 config，loader 先填 schema 默认值）。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-client-ui-mermaid typecheck
pnpm --filter @linxin666/dsh-client-ui-mermaid test
pnpm --filter @linxin666/dsh-client-ui-mermaid build
```
