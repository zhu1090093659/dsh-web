# AGENTS.md — dsh-taskboard-agent

任务看板 agent 桥接插件（host + browser 双半区）：让 agent 能读 / 改 / 删看板
卡片，与 dsh-web-ui 全家桶的 `dsh-task-board`（浏览器看板 UI）协同工作。

## 架构（v2 双向桥）

- host 半区 `src/index.ts`：
  - 4 个工具 `task_board_create` / `task_board_list` / `task_board_update` /
    `task_board_delete`，全部 `defineTool()` 包装后 `tools.register()`；
  - mutation 队列：工具入队 op 信封（create / update / delete），浏览器轮询
    `GET /api/dsh-taskboard-agent/pending` 取走应用；
  - snapshot：浏览器 ledger 镜像（浏览器 `POST /api/dsh-taskboard-agent/sync`
    推来），供 `task_board_list` 只读；
  - 文件持久化：默认 `{DSH_HOME}/dsh-taskboard-agent/board.json`（config.filePath
    可覆盖），apply 时载入、每次 sync 写盘；读写失败降级纯内存，不崩。
- browser 半区 `src/client.ts`：每 1.5s 一轮 = pushSync（POST 推当前 ledger，
  空数组也推，保证镜像准确）+ GET /pending 应用 ops（create 去重 / update 合并
  patch 并刷 updatedAt / delete 按 id 移除）；经 `window.__ModuleLoader__.load`
  注册，**id 必须等于包名**（本包为 `@linxin666/dsh-taskboard-agent`）。

## schema 硬约束（踩坑总结，违反必炸）

1. 工具必须 `defineTool()` 包装后 `tools.register(defineTool(tool))`；
2. 参数方言：属性级 `required` 只能缺省或为 true，禁止 `required:false`；
3. `output.schema` 是值 schema DSL，禁止顶层 `required` 数组；
4. `output` 必须含 `{ schema, render }`。

## 已知坑

- POST /sync 的 req chunk 可能是 Buffer 或字符串（mock 流），按文本统一拼接
  （`typeof c === 'string' ? c : c.toString('utf8')`）；
- GET /pending 保留 `.tasks`（仅 create）字段兼容旧 bundle；新客户端用 `.ops`；
- 浏览器半区无任何 UI 依赖（纯 fetch/localStorage），不要引入 React 或
  dsh-client-* 运行时；
- 提交物不得含 emoji（全仓规则）。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-taskboard-agent typecheck
pnpm --filter @linxin666/dsh-taskboard-agent build
# 行为验证：本仓库内测试（17 条断言覆盖工具注册 / mutation 队列 / POST /sync / 落盘）
```
