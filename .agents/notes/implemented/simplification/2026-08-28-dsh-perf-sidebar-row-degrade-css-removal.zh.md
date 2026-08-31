# Agent Note: 移除 dsh-perf 侧栏会话行降载 CSS

Status: implemented

部分取代 [dsh-perf 渲染管线第二批](../feature/2026-08-26-dsh-perf-render-pipeline-batch2.zh.md) 中「侧栏会话行降载 CSS」一条——该笔记其余决策不受影响。

## 问题

dsh-perf 的降载样式曾向 dsh-better-sidebar 渲染的侧栏会话行（`[class*="_sidebarCol"] [class*="_sessionRow"]`）注入 `content-visibility: auto` 加 `contain-intrinsic-size: auto 32px`。固定 32px 占位行高把屏外行钉在固定高度上，侧栏真实行高一旦不是这个值，行就落在错误位置，侧栏自身布局明显被破坏。这条规则还基于类名子串猜测跨过插件边界、伸手进另一个插件的 DOM，内嵌的实测常量在上游布局一变时就会悄悄失效。

## 决策

从 `packages/dsh-perf/src/client/index.ts` 的 `installPerfCss` 中删除侧栏会话行规则。dsh-perf 的 CSS 降载范围收回消息行本身（`[data-chat-flow-kind="assistant-step"]` / `[data-chat-flow-kind="tool-call"]`）。dsh-better-sidebar 的侧栏按该插件自己的布局原样渲染，不再被注入 containment。包 README 改为声明这一「刻意不处理」，构建产物中不再包含 `_sessionRow` 选择器。

## 考虑过的替代方案

- 把规则挂到设置开关上（默认关）：否决——这条规则只服务过一次对第三方布局的假设，且已在实际使用中证明有害；一个休眠的跨插件 CSS 覆盖是没有用户的表面积。
- 保留 `content-visibility`、只去掉 `contain-intrinsic-size`：否决——没有占位高度时浏览器对屏外行高的猜测更差，而且任何锚定 `_sidebarCol` 的规则仍然把 dsh-perf 耦合在另一个插件的类名上。

## 影响

侧栏会话行恢复按真实位置渲染，固定 32px 钉扎消失。dsh-perf 最初针对的代价——dsh-better-sidebar 大分组展开时一次性挂载数百行（上游 issue 仍在）——重新以未缓解的状态存在；本变更把这笔未量化的收益换了回去，换来另一个插件表面的布局正确性。

## 测试

`pnpm --filter @linxin666/dsh-perf test` 54/54 通过，`tsc --noEmit` 无错误；包构建成功，grep `lib/` 找不到 `_sessionRow` 规则；`pnpm docs:check` 通过，README 配对哈希已重录。
