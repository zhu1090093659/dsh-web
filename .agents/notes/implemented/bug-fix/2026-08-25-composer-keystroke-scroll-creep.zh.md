# Agent Note: 会话滚动条在输入框键入时持续蠕动 — 行级 scroll-margin 留空

Status: implemented

## Problem

阅读历史消息时（会话滚动口不在底部），在输入框每敲一个键，会话滚动位置就向下蠕动一点，永不固定——边看旧消息边打字时，视图被不断拖离正在读的位置。该问题在目录册皮肤、自定义主题或壁纸激活期间出现，即公共壳层渲染适配器装入其样式表的任何时候。

## Decision

公共壳层渲染适配器（`packages/skins/skin-center/src/client/runtime/shell-rendering.ts`）不再用会话滚动口（`[data-conversation-scroll]`、`[data-dsh-part="scrollport"]`）上的 `scroll-padding-bottom` 预留底部留空。留空改到正文行本身（`[data-chat-anchor-key]` 与镜像自 backdrop-scene 的 `*_Row` class 兜底）上，以 `scroll-margin-bottom: var(--dsh-composer-height, ...)` 实现；滚动口依旧保持零物理 `padding-bottom`。

### 为什么滚动口级 scroll padding 会蠕动

官方壳层的 composer 座位是 `position: sticky; bottom: 0`——会话滚动口最后一个流内子元素，其光标永远渲染在滚动口的底部带内。每次键入后浏览器执行 caret-reveal（"把焦点光标滚进可见区"）；由于 `scroll-padding-bottom` 把 composer 高度的带保留为不可见区，光标在该带内被判定为"未显露"，浏览器便向下滚动以满足它——每键一次滚一次，打多久滚多久。把滚动口级 scroll padding 换成行级 scroll margin 后，`scrollIntoView()` 的留空（#978 的目标：正文行落在吸底 composer 上方可读）保持不变，而 caret-reveal 几何不再被触碰——scroll-margin 只作用于滚动定位/scrollIntoView 目标，从不作用于焦点显露。

## Alternatives considered

保留 `scroll-padding-bottom` 并以其它方式抑制 caret-reveal（如重聚焦技巧或取消 scroll 事件）。否决：用 JS 对抗浏览器的焦点显露跨引擎脆弱，且当 composer 文本域自身长高（多行草稿）时会破坏真实的光标可见性。

用物理 `padding-bottom` 替代 scroll padding。早已否决（#978 已移除）：它会把激活态 dock 抬高一个 composer 高度，并把居中 hero 顶到中线上方。

完全移除留空。否决：会让 #978 回退——`scrollIntoView()` 式导航会把正文行停在吸底 composer 背后。

## Testing

Playwright 最小复现（溢出滚动口内的 sticky composer 座位）证实了机制：`scroll-padding-bottom: var(--dsh-composer-height)` 下每次键入 scrollTop 固定步进蠕动（8 键 456 -> 680）；换成行级 `scroll-margin-bottom` 后 scrollTop 全程钉住（8 键均为 456），且 `scrollIntoView({ block: 'end' })` 仍把最后一行精确落在 sticky 座位上方。单元门禁：`tests/skin-runtime.spec.ts` 现在断言滚动口规则不含 scroll padding、行规则携带 scroll-margin 留空（36/36 通过）；包 typecheck 通过；`verify-docs` 配对已重录。
