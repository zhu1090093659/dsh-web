# @linxin666/dsh-client-ui-mermaid

[English](README.md) | 中文

DSH web GUI 插件 mermaid —— 把助手消息中的 mermaid 代码围栏渲染为 SVG 图表，
附源码切换与设置卡片。

## 功能

官方 shell 把助手 markdown 围栏渲染为普通代码块（围栏管线没有图表渲染器）。
本插件监听会话 DOM，找到标记为 `mermaid` 的围栏，用内置的
[mermaid](https://mermaid.js.org/) 运行时把每个围栏换成 SVG 图表：

- 原始源码一键可见（图表工具栏切换按钮）；
- 语法错误的图表保持源码可读，并显示解析错误；
- 流式输出中的围栏随源码增长重渲染，落定后只渲染一次；
- 主题跟随界面明暗（`auto`），或固定为 mermaid 内置主题
  （`default` / `dark` / `neutral` / `forest`）；
- 设置 -> 插件配置 -> Web UI 插件 出现本插件卡片（启用开关 + 主题选择）；
  关闭开关即时把所有图表还原为普通代码块，无需重启。

mermaid 库打包进插件客户端产物（压缩后约 2 MB），渲染完全离线可用，
不会请求任何 CDN。

## 安装

### 从 npm 安装（推荐）

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-mermaid
```

### 从仓库安装（开发）

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install
pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-mermaid
```

也可一次链接整个全家桶（见仓库 README），随 `dsh-web-ui-all` 一并挂载。

## 已知限制

- 图表渲染依赖真实浏览器排版引擎；本插件只在 Web GUI 生效（终端会话无效）。
- 图表增强是 DOM 层面的（SDK 未提供围栏渲染槽位）：未来 shell 若改变
  CodeBlock 标记结构，本插件退化为无操作，直至选择器更新。
- `auto` 主题按 body 背景亮度采样，背景接近中灰的皮肤两个方向都可能解析；
  此时请固定主题。

## 许可证

BSD-3-Clause。
