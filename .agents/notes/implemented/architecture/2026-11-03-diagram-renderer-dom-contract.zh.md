# Agent Note: 图示渲染借用 markdown 渲染器的 DOM

Status: implemented

## Problem

官方 markdown 渲染器（\`ui-primitives\` 的 \`MarkdownText\`）没有代码块扩展缝：mermaid 围栏被当作
未知语言（纯文本）高亮，渲染成带复制按钮的普通代码块。家族自己的 mermaid 渲染随
\`dsh-aionui-panel\` 一起离仓，于是架构文档里的八张 mermaid 图、以及用户粘进会话的 mermaid，
都没有任何出图路径。

数学是另一回事，本次刻意不碰：渲染器已自带 KaTeX 与美元符/反斜杠两套定界符
（\`micromark-extension-math\` 加一个兼容扩展），再实现一遍只会和宿主抢渲染。

## Decision

- **新增 \`dsh-diagrams\` 包，原地渲染 mermaid 围栏。** 一个观察器同时覆盖会话正文与文档预览
  面板，因为两个面走的是同一个组件。
- **接入点是渲染出的 DOM。** 页面侧观察器盯 \`document.body\`，把每批变更映射到所属的
  \`div.md-code-block\`，再从 banner 的 infostring 元素读围栏语言。这些名字钉在一个模块里
  （\`src/core/contract.ts\`），旁边就是契约测试。
- **原代码块只隐藏、不删除。** 渲染器的复制按钮仍从 \`<pre>\` 取源码；渲染失败按原样恢复。
- **运行库由本包伺服、按需拉取。** 宿主半区只有一条只读路由
  （\`/api/dsh-diagrams/vendor/mermaid.js\`，走共享配对围栏），伺服构建时从 npm 包复制到
  \`lib/assets/\` 的 mermaid IIFE。没有 mermaid 块的页面不下载任何东西。
- **渲染出的 SVG 二次消毒。** mermaid 以 \`securityLevel: 'strict'\` 运行，输出仍要过一遍剥除
  （元素、\`on*\` 属性、\`javascript:\` URL）；清理后仍可疑的标记被拒，围栏退回代码块。
- **主题切换重绘。** mermaid 把颜色画进 SVG，明暗切换按保存的源码重绘每张已完成的图。

## Alternatives considered

- **改宿主渲染器或给它加扩展点。** 规则与设计都不允许：宿主不是本仓；家族的浏览器半区只能
  类型导入宿主客户端模块——没有任何注册代码块渲染器的缝。
- **给这两个面自建 markdown 渲染器。** 否决：为了一个围栏语言要复刻宿主的表格、脚注、数学与
  流式渲染。
- **把 mermaid 打进客户端 bundle。** 否决：库压缩后约 2–3 MB，没有图示的页面也要付这份带宽。
- **从 CDN 拉 mermaid。** 否决：桌面客户端要能离线，第三方源进页面也与家族的「同源」立场相悖。
- **现在就扩到其它图 DSL。** 延后：用户把本次范围限定在 mermaid；观察器与渲染表就是第二种 DSL
  将来接入的位置。

## Consequences

- **DOM 钩子不是契约。** 宿主若改名 \`md-code-block\` 或 infostring 类名，图示渲染停止，围栏退回
  代码块。钉住的常量与它们的测试，让这件事在 SDK cohort 升级时变成显式失败，而不是静默退化。
- **流式围栏延后出图。** 未闭合的围栏无法解析；源码确实变化后在静默期之后重试，围栏闭合后出图。
- **渲染是排程而非一次点火。** mermaid 在页面主线程上同步解析与布局，因此一张图一帧地绘制
  （对帧被节流的标签页配超时兜底），消毒后的 SVG 按「主题 + 源码」记忆化，运行库只在配色变化时
  \`initialize\`。被拒的源码是终态：每次 DOM 变更都重试会让回滚本身再次触发这一趟，把页面空转起来。
- **家族行自带展示元数据。** 聚合的 \`shellNotes\` 覆盖的是家族子路径（tombstone 兼容空壳）；挂真实
  包的行，标题与用途说明来自该包自己的 \`locale/{en,zh}.json\`，本包因此随包带上这两个文件。
- **vendor 运行库是构建产物。** \`lib/assets/mermaid.min.js\` 由 tsdown 复制、从不提交；跳过这一步的
  构建会退化为 404 加普通代码块。
- 再加一种图 DSL 是渲染表里加一项，而不是再加一个观察器。

## Testing

\`pnpm --filter @linxin666/dsh-client-ui-diagrams typecheck\` 与 \`test\`（21 个用例：块发现、
认领/恢复、SVG 消毒、观察器渲染与失败回落与主题重绘、变更范围映射、vendor 路由的
200/403/404/405/HEAD，以及契约钉桩）。实时验收需要包被挂载（即宿主重启），因此留给用户确认，
不在此声称已验证。
