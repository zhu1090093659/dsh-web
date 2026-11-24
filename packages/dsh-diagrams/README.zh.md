# dsh-diagrams

[English](README.md) | 中文

DeepSeek Harness Web GUI 的 mermaid 图示渲染：会话正文或文档预览面板里的 mermaid 代码块会原地渲染成 SVG 图，而不是留成代码块。

## 功能

- **在你阅读的地方出图**：会话正文接入官方 `conversation.chat.markdown.fence` hoc 槽位（`key: 'mermaid'`），流式写入期间直接展示源码代码块、落定后替换为 SVG 图；尚未传入 `renderCode` 的文档预览面板由受控 DOM 观察器兜底覆盖，并自动跳过已由官方槽位托管的区域。
- **按需加载**：mermaid 运行库由本包自己的宿主路由伺服，只有在页面真的出现 mermaid 块时才拉取，因此没有图示的会话不会多下载任何东西。
- **跟随界面主题**：明暗切换时按保存的源码重绘并复用缓存——mermaid 把颜色画进 SVG 本身，CSS 改不动它。
- **绝不破坏文档**：运行库缺失、围栏还在流式写入、或图示被解析器拒绝，都会原样回退显示官方代码块。

## 安装

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-diagrams
# 重启 dsh web
dsh web
```

安装全家桶（`@linxin666/dsh-web-all`）会一并挂载本包；该行出厂默认开启，可在插件管理里按行关闭。

## 配置

没有设置项。本包只注册一条只读宿主路由、一个官方 `conversation.chat.markdown.fence` 槽位层与一个文档预览兜底观察器，没有可配置项。

## 已知限制

- **文档预览兜底仍依赖渲染器 DOM 钩子**：会话正文已迁移至官方 `conversation.chat.markdown.fence` 契约槽位；文档预览面板等未传 `renderCode` 的 Markdown 视图继续通过 `md-code-block` 类名与 banner 钩子（`_infostring` / `_language`）兜底识别。高亮器不认识的语言（mermaid 即其中之一）在 span 里显示本地化占位符（如 `代码块` / `Code block`），因此兜底路径在标签不是真实语言 token 时回退到源码首个 mermaid 关键字判定；真实语言标签一律不接管。被钉住的常量集中在 `src/core/contract.ts`，旁边有契约测试。
- **流式围栏落定后出图**：回复仍在流式写入时，官方槽位层直接返回源码代码块，避免反复解析半截围栏；文档预览兜底路径对被拒围栏只在短暂静默期后、且源码确实变化时才重试。
- **不提供图示主题选择**：图跟随界面的明暗状态，mermaid 自身的主题变量没有暴露成设置项。

## 安全模型

- vendor 路由（`/api/dsh-diagrams/vendor/mermaid.js`）先过信任围栏：本机（loopback）及官方宿主已认证连接（`connection.admit`）通过；其它未认证客户端在读资产之前就被 403 拒绝。
- 路由只读：只应答 `GET` 与 `HEAD`，其余方法 405。
- 运行库同源来自已安装的包，不访问任何 CDN。
- 渲染出的 SVG 在 mermaid 自身 strict 等级之外再走一遍消毒：可执行元素、`on*` 事件属性与 `javascript:` URL 一律剥除；清理后仍带可执行 token 的标记被拒——该块保持为代码块。
