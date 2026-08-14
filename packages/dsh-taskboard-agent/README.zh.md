# dsh-taskboard-agent — 任务看板 agent 桥接插件（DSH）

[English](README.md) | 中文

为 DeepSeek Harness（DSH）定制的双半区（host + browser）插件：桥接 agent 与
[dsh-task-board](https://github.com/zhu1090093659/dsh-web-ui/tree/main/packages/dsh-task-board)
看板 Web GUI。agent 通过四个工具读 / 改 / 删看板卡片；看板在页面刷新（F5）后
显示 agent 的改动，GUI 手动改动约 1.5 秒内回流给 agent。纯官方 `@deepseek-ai/*`
NPM SDK 实现，不修改 DSH 源码。

## 能力

| 能力 | 说明 |
| --- | --- |
| Agent 工具 | `task_board_create` / `task_board_list` / `task_board_update` / `task_board_delete` |
| 双向同步 | 浏览器每 1.5s 轮询：推送看板 ledger 到宿主，取走 mutation 队列并应用到 `localStorage["dsh.taskBoard.v1"]` |
| 文件持久化 | 宿主镜像持久化到 `{DSH_HOME}/dsh-taskboard-agent/board.json`；重启不丢，I/O 失败降级纯内存 |
| 向后兼容 | `GET /pending` 保留旧 `.tasks` 字段（create ops），同时提供完整 `.ops` mutation 队列 |
| 无 UI 依赖 | 浏览器半区纯 fetch/localStorage，无 React 或客户端 SDK 依赖 |

## 工具

- `task_board_create` — 建一张卡（title 必填；description / prompt 可选）。
- `task_board_list` — 从宿主镜像列卡；可选 `status` 过滤（todo / in_progress / done）。
- `task_board_update` — 按 id 更新 `status` / `title` / `description` / `prompt`（入队，下次同步应用）。
- `task_board_delete` — 按 id 删卡（入队，下次同步应用）。

mutation 是异步的：浏览器约 1.5s 内应用，刷新（F5）后看板可见。

## 安装

从聚合全家桶安装，或单独加包：

```sh
dsh plugin --profile web add @linxin666/dsh-taskboard-agent
```

或从仓库安装（开发调试）：

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-taskboard-agent
```

安装后重启 `dsh web`：四个工具对 agent 可用，系统提示词自动宣告桥接。

## 架构

- host 半区 `src/index.ts`：注册四个工具与两条路由：
  - `GET /api/dsh-taskboard-agent/pending` — 取走 mutation 队列（create / update / delete op 信封）。
  - `POST /api/dsh-taskboard-agent/sync` — 接收浏览器 ledger 快照；替换宿主镜像并落盘。
- browser 半区 `src/client.ts`：每 1.5s 推送当前 ledger，并取走 + 应用 ops
  （create = 追加去重，update = 合并 patch 并刷新 `updatedAt`，delete = 按 id 移除）。
  空 ledger 也照常推送，宿主镜像不会读到陈旧数据。
- 持久化：`{DSH_HOME}/dsh-taskboard-agent/board.json`（可用插件配置 `filePath`
  覆盖）；文件缺失 / 损坏时降级为空内存镜像。

## 数据

- 看板数据在浏览器 `localStorage["dsh.taskBoard.v1"]`（归任务看板插件所有）；
  本插件只做镜像。
- 宿主镜像：`{DSH_HOME}/dsh-taskboard-agent/board.json`。

## 开发

```sh
pnpm --filter @linxin666/dsh-taskboard-agent typecheck
pnpm --filter @linxin666/dsh-taskboard-agent build
```

行为验证由本 PR 引入的测试覆盖（17 条断言）：工具注册（过真实
`assertSupportedJsonSchema`）、mutation 队列、`POST /sync` 快照替换、
文件落盘、list / update / delete 逻辑。

## 已知限制

- mutation 在浏览器轮询时应用（最多 ~1.5s 延迟）；GUI 标签页关闭时会延迟到
  下次加载看板。
- `status` 词表是看板自身的（todo / in_progress / done）；其它值会存储但看板
  UI 不渲染。
- 宿主镜像只新鲜到最近一次浏览器推送；看板 UI 的直接改动在下次轮询后可见。
