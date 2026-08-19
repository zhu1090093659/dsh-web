# 测试报告：page-annotate 侧边栏图标渲染修复

- 日期：2026-08-19
- 包：@linxin666/dsh-page-annotate（dsh-web-ui 仓库，worktree .worktrees/dsh-page-annotate，分支 feat/page-annotate）
- 修复提交（计划）：fix(page-annotate): render tab icon as SVG element instead of raw source text

## 缺陷描述

DSH Web GUI 右侧面板「网页批注」tab 的图标异常：侧边栏/home 面板中该条目把
SVG 图标源代码当文本直接显示（`<svg viewBox="0 0 16 16" ...></svg>` 整段源码
被折行、居中、大字号排版），而其他 tab（文件、终端、浏览器等）图标均正常渲染
为图形。

### 根因

`src/client/index.ts` 中 tab 图标被定义成**纯字符串**：

```ts
const ICON = '<svg viewBox="0 0 16 16" ...></svg>'
```

`TabDescriptorLike.icon` 的类型是 `ReactNode`，字符串是合法 ReactNode（故
typecheck 不报错），但 React 将字符串按**文本节点**渲染，于是界面上出现整段
SVG 源码文本。

### 修复

- 新增 `src/client/tab-icon.tsx`，导出真正的 React SVG 元素 `TAB_ICON`。
- `src/client/index.ts` 删除字符串常量 `ICON`，注册 tab 时改用 `TAB_ICON`。

## 测试用例

新增用例位于 `packages/page-annotate/tests/index.test.ts`：

| 用例 | 断言 | 结果 |
| --- | --- | --- |
| registers a rendered icon, not the raw SVG source text | icon 非字符串；renderToStaticMarkup 输出包含 `<svg` 与 `viewBox`；不包含转义源码 `&lt;svg` | 通过 |
| registers the tab only after the betterSidebar service is provided | 注册时序（既有回归用例） | 通过 |
| never registers or throws when better-sidebar is absent | 容错（既有回归用例） | 通过 |
| unregisters the tab when the provider goes away | 注销（既有回归用例） | 通过 |

## 执行结果

```
# pnpm --filter @linxin666/dsh-page-annotate test
Test Files  10 passed (10)
     Tests  51 passed (51)

# pnpm --filter @linxin666/dsh-page-annotate typecheck  （通过，exit 0）
# pnpm build（包构建成功，lib/client.js 生成）
# pnpm docs:check（verify-docs: all documentation gates passed）
```

## 运行态验证（Playwright 实测 DSH Web GUI）

修复后加载 http://127.0.0.1:53629（服务器直接 serve 本 worktree 的
lib/，bundle MD5 与本地构建产物一致）：

- 「网页批注」文本仅出现 1 次（作为 tab 标题）。
- 该 tab 按钮（paneCard）内存在 1 个真实 SVG 图标元素：
  `viewBox="0 0 16 16"`、`stroke="currentColor"`、width/height 14。
- 全页无任何 `<svg` 源码文本泄漏（textNodes 计数 0）。

## 回归范围

- 改动仅限 page-annotate 包 browser 半区 client 入口与新增图标文件，不影响
  其他包。
- 仓库全量 `pnpm typecheck` / `pnpm docs:check` 通过；`pnpm test` 中
  dsh-remote-web-ui 包因 node_modules 缺失 `*.js.map` 的既有环境问题失败，
  与本次改动无关（page-annotate 全部 51 用例通过）。

## 验证结论

缺陷已修复：网页批注 tab 图标现在渲染为真实 SVG 图形，与同面板其他图标一致；
SVG 源码不再泄漏为可见文本。TDD 流程（先写失败用例 → 修复 → 用例转绿）完成。
