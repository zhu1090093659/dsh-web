# Agent Note: 暗色徽章修正改为皮肤选择器作用域内

Status: implemented

## Problem

为 #1117 提交的推荐徽章对比度修正从未生效。`shellRenderingCss()` 生成的每条规则都会先加上
"当前视觉作用域"前缀列表（`html[data-dsh-skin]`、`html[data-dsh-custom-theme]:not([data-dsh-skin])`、
`html[data-dsh-wallpaper-active]`），而徽章规则又在这份已带作用域的选择器前面加了
`body[data-ds-dark-theme]`：

```css
body[data-ds-dark-theme] html[data-dsh-skin] [data-question-key] [class*="_badge"] { ... }
```

暗色属性由宿主设在 `<body>` 上（DSH `packages/client/ui-theme/src/boot-theme.ts:20`），而 `html` 是
`body` 的祖先，因此这条后代链无法匹配任何元素。规则始终是死的，激活皮肤的暗色用户依旧面对这条修正
本来要解决的近似 1:1 对比度（#1490）。

## Decision

把 `body[data-ds-dark-theme]` 复合选择器移入作用域参数内部，使每个作用域都生成
`html[...] body[data-ds-dark-theme] [data-question-key] [class*="_badge"]`——该属性成为作用域元素的
后代而非祖先。`tests/shell-rendering.spec.ts` 增加两条守卫：一条断言生成的徽章选择器保持该顺序，另一条
扫描整张样式表的逗号分隔选择器，拒绝"某个 `body[` 复合选择器出现在 `html[` 之前"的通用形状，使同类
错误无法从其它规则再次引入。

## Verification

- `pnpm --filter @linxin666/dsh-client-ui-skin-center test`：38 个文件、631 条测试通过（新增 2 条）。
- `pnpm --filter @linxin666/dsh-client-ui-skin-center typecheck`：通过。
- `pnpm skin-center:check`：通过。
- 被提交的 `lib/client.js` 产物由后续的构建提交刷新，不手工修改。

## Alternatives considered

完全去掉 `body[data-ds-dark-theme]` 限定被否决：那会连浅色主题下的徽章配色一起改写，而浅色下上游
token 本身对比度正常。

改用 `html:has(body[data-ds-dark-theme])` 表达该条件被否决：属性就在 `body` 上，普通后代选择器已经
足够，`:has` 只会增加匹配成本与兼容面。

只修这两条徽章选择器、不加通用守卫被否决：这个错误来自"作用域助手 + body 级条件"的组合方式，任何后续
规则都可能重蹈覆辙。

## Consequences

项目以为早已上线的暗色徽章对比度现在真正生效，样式表也有了针对作用域顺序错误的机械守卫。上游
`_badge` 选择器的耦合方式未变，因此上游若重命名该类，仍需同步更新此规则。
