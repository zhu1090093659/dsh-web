# @linxin666/dsh-client-ui-skin-xp

[English](README.md) | 中文

适用于 dsh Web GUI 的 Windows XP（Luna 蓝）皮肤。以客户端插件方式热插拔：`apply()` 设置 `data-dsh-xp` body 属性（整张样式表的作用域）、渲染固定顶部的 Luna 蓝色标题栏（带四色窗口旗标和最小化 / 最大化 / 关闭三个窗口按钮）、经典米色状态栏（就绪 / DeepSeek 在线，右侧带凹陷的 大写 数字 滚动 指示灯）、侧边栏底部任务栏蓝条上的绿色「开始」按钮（点击打开设置对话框）、资源管理器风格的树行（浅蓝悬停、`#316ac5` 蓝色选中）、窗口框架背后 Bliss 风格的蓝天桌面，以及全局直角，并固定文档标题、注入四色旗标 favicon；effect disposer 会撤回全部写入——属性、两条栏、开始按钮、favicon，以及标题（除非会话标题已将其覆盖）。样式表随 bundle 的 CSS-modules 自动注入，入口卸载时由 loader 一并移除。

皮肤只做呈现：不注入服务、不发 cordis 事件、不触及模型请求。暗色配色（`body[data-dsh-xp][data-ds-dark-theme]`）为 Zune 风格黑色变体，底层主题系统仍可继续翻转 token。滚动条别名保留在基础主题上，皮肤之下的滚动条契约不变。

## 安装（官方 bundle 方式）

推荐先装皮肤全家桶聚合包 `@linxin666/dsh-skins` 一次到位；只装本皮肤时用下列 link 命令。

```sh
# 装全部皮肤（推荐）
dsh plugin --profile web add @linxin666/dsh-skins
# 或单独装本皮肤
dsh plugin --profile web add @linxin666/dsh-client-ui-skin-xp
# 皮肤启用：dsh-skin use xp
# 从仓库安装（开发调试）：dsh plugin --profile web add link:$(pwd)/packages/skins/xp
```

`$(pwd)` 指克隆全家桶仓库后的目录。

本地 link 安装前需先在全家桶仓库内构建产物（`lib/` 被 git 忽略、不随仓库提交）：
`pnpm install && pnpm -r build` 后再 link 安装。
通过 git 安装（`dsh plugin --profile web add github:<org>/dsh-web-ui#<sha>`）时
`prepare` 脚本自动自包含构建 `lib/`，无需单独构建；pnpm ≥10 首次安装 git 依赖需先把
pnpm 打印的包键加入相应 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 列表再重试。

皮肤启用 / 切换用 `dsh-skin use xp`（本仓库 `scripts/dsh-skin` 辅助脚本）；同一时刻只激活一个皮肤。

## 依赖

面板级装饰（侧边栏标题带、资源管理器树行、任务栏底部、会话/详情面板）依赖 `ui-layout` 中 AppFrame 列携带的 `data-pane` 属性；没有它们皮肤仍会生效，只是缺少各面板专属表面。

## 模型体验

无。皮肤只改动浏览器 DOM，不触及模型请求。

#### KV Cache 影响

无；本包既不组装也不发送任何 provider 请求。

## 已知限制

- 加载页保持原样。外壳的启动页在插件 bundle 存在之前就已渲染，皮肤从 UI 稳定后开始生效（属性一旦设置，启动页也会获得窗口边框，但其内部卡片保持现代风格）。
- 主题切换在皮肤内部。皮肤在两种 `data-ds-dark-theme` 状态下各自固定配色；切换外观主题只会翻转浅色 Luna / 深色 Zune 两套配色，不会回到非皮肤外观。
- 「开始」按钮只打开设置。它把点击转发给侧边栏底部已有的设置入口，并不承载真正的开始菜单。
- 四色旗标是平面近似。飘扬的 Windows 旗标以平面 2×2 旗标呈现（内联 SVG），并非真实的波浪形 Logo。
