# Agent Note: Mobile chat rendering fixes for tool-call bubbles and streaming text truncation

Status: implemented

## Problem

在移动端页面（/m/，@linxin666/dsh-remote-web-ui）中，消息渲染存在两处体验缺陷（Issue #1065）：
1. 空气泡：在移动端显示设置中关闭“工具调用”（showToolCalls: false）后，仅包含工具调用、无正文且无思考过程的 assistant 消息仍会渲染为一个仅含时间戳的空白气泡；
2. 流式期间过早折叠：长消息（>1600字）在流式生成中（pending: true）即被限制在 45vh 高度内（overflow: hidden），导致新输出内容在手机上不可见且无法跟随自动滚动；此外 1600 字阈值偏低，导致常规 Markdown 表格与分析回复频繁被折叠截断。

## Decision

1. 在 MessageRow 中增加内容可见性守卫：无思考过程、无可见工具调用（无工具或 showToolCalls: false）、无正文且非失败（!failed）的 assistant 消息整行不渲染（eturn null），彻底消除空白气泡。
2. 调整 MarkdownText 折叠判定逻辑：将长消息判定改为 !pending && text.length > LONG_TEXT_LIMIT，确保流式生成期间内容完整展示并支持自动滚动跟随。
3. 将长消息折叠阈值 LONG_TEXT_LIMIT 从 1600 字提升至 6000 字，使常规表格与分析报告无需手动展开即可完整阅读，仅对生成结束后超过 6000 字的超大消息保留显式“展开全文”折叠按钮。

## Alternatives considered

在 oldEvents / EventFolder 数据层过滤掉仅含工具的消息：未采纳，因为 RenderMessage 数据结构代表底层会话真实状态，保留在数据层可支持用户在设置中实时切换工具调用显示而无需重新拉取历史记录；该过滤应属于视图渲染层（MessageRow）职责。

在流式输出期间保持 chat-md-collapsed 结构并通过高度计算动态扩展：未采纳，相比于在流式期间（pending: true）直接不应用折叠样式，动态计算高度不仅引入不必要的 DOM 测量开销与布局抖动，而且逻辑更脆弱。

## Consequences

在显示设置中关闭工具调用后，工具调用步骤将被彻底隐藏且不留空气泡；长回复在生成过程中完整可见且可跟随滚动；常规长度表格与报告无需额外点击展开。代价是生成结束后处于 1600 至 6000 字之间的回复在消息流中会占据稍多的垂直高度。
