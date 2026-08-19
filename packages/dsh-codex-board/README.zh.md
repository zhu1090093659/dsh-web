# @linxin666/dsh-client-ui-codex-board

[English](README.md) | 中文

Codex 风格悬浮任务看板插件：在 DSH Web GUI 右上角悬浮一块小看板，实时镜像当前
会话中 agent 用 `todo_write` 工具维护的任务列表。标题显示「完成数/总数」与进度条，
每行带三态标记（待办 / 进行中 / 已完成），点击标题可折叠（按会话记忆）。

- 不修改 DSH 源码：以 cordis 插件 + `document.body` 全局挂载（外挂形态与
  `dsh-pet` 一致），卸载即恢复原状。
- 数据来自官方会话投影：host 把 `todo/write` 事件折叠为 `session/projection`
  帧（key `todos`），浏览器端经 `sessions.binding(id).session.projections.faceOf('todos')`
  订阅，无需任何 DSH 源码改动。

## 功能

- **右上角悬浮**：固定在 GUI 右上角（顶部偏移 72px、右侧 16px），不遮挡会话主体；
  仅在「有会话且任务列表非空」时渲染，新会话屏 / 空列表不占位。
- **进度概览**：标题显示 `完成数/总数`，下方细进度条按完成比例填充，带无障碍
  progressbar 语义。
- **三态任务行**：待办（空心圆）/ 进行中（脉冲圆点，行高亮）/ 已完成（对勾圆，
  文字划线淡化）；进行中的任务行背景微高亮，一眼看出当前在做什么。
- **折叠/展开**：点标题折叠成一条摘要（仍显示计数），再点展开；折叠状态按会话
  持久化（localStorage），切换会话互不干扰。
- **实时跟随**：跟随会话列表 `current` 切换；同一会话内任务状态变化（todo/write
  帧）即时刷新。

## 目录结构

```
package.json / tsconfig*.json / tsdown.config.ts / vitest.config.ts   # 独立仓库构建
src/index.ts                                  # host 半区：仅注入系统提示段
src/client/index.ts                           # apply(ctx)：订阅 sessions + 挂载 document.body
src/client/CodexBoard.tsx                     # 悬浮看板组件（进度 + 三态列表 + 折叠）
src/client/codex-board.module.css             # 样式（--dsw-* token，随皮肤自适应）
src/client/locales.ts                         # zh/en 文案
src/core/derive.ts                            # 纯派生：进度计算 / 折叠持久化
tests/derive.spec.ts                          # core 单测
tests/codex-board.spec.tsx                    # 组件冒烟 + 交互测试
```

## 安装

推荐直接安装全家桶聚合包 `@linxin666/dsh-web-ui-all`，或单独安装本插件：

```sh
### 从 npm 安装（推荐）
dsh plugin --profile web add @linxin666/dsh-client-ui-codex-board

### 从仓库安装（开发调试）
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-codex-board
```

安装后**重启 `dsh web`**，右上角出现悬浮看板即生效；页面刷新不够，需重启进程。

## 构建

前置：Node >= 22，官方 NPM SDK 可访问。类型与运行时 API 全部来自官方 NPM SDK
（`@deepseek-ai/*` devDependencies），无需任何 DSH 源码 checkout。

```sh
cd ~/code/dsh-web-ui/packages/dsh-codex-board
pnpm install        # 首次（workspace 根执行 pnpm install）
pnpm run build      # 产出 lib/index.js + lib/client.js（tsdown + shared/tsdown.client.ts 预设）
pnpm run typecheck  # 类型检查（node_modules 的 SDK 包类型）
pnpm test           # vitest 单测
```
