# Agent Note: 移除 dsh-perf 的 Better Session 卡片与 bsm 迁移核心

Status: implemented

## 问题

dsh-perf 的 Better Session 卡片在 @morlay/better-session 集成已移出聚合包之后仍在管理它（[drop-deprecated-better-session-integration](2026-09-02-drop-deprecated-better-session-integration.md)）。它的启用开关改写的是已不存在的聚合行的托管覆盖，所以卡片永远只能呈现未启用姿态（官方 jsonl 存储）——「启用并迁移」这条路已经无处可去。保留它要养着 host 半区一整个模块目录（`src/bsm/`：路由、service、迁移核心与执行器、legacy-log 编解码、profile 托管块、导入 worker 入口）、一张客户端卡片及其词典、一个挂在 package export 后面的独立构建产物、五个测试文件，以及 24 个集中维护的 ru 键——全部跟着每次构建、审计与 cohort 升级走。

## 决策

管理面从 dsh-perf 整体移除。`src/bsm/` 与客户端卡片模块删除；perf 设置卡不再挂载 Better Session 子节；client 半区在 dsh-perf 命名空间下只注册 perf 词典；`./better-session-import` 导出与其 tsdown companion 构建删除；五个 bsm 测试文件删除；dsh-i18n 中央 ru 词典失去 24 个 `bsm.*` 键；i18n 审计的包表重新只列 dsh-perf 的单一词典模块。e2e 挂载注释改为陈述集成已移除而非默认关闭。

dsh-perf 回归纯性能观测插件：meter、HUD、stats 路由、写批调优行、完整性观察器、列表门控与设置卡。

## 已考虑的替代方案

- 保留卡片作为只读的旧会话清单（它还能统计 326 个跨 25 个项目的旧 jsonl 会话）：否决——展示背后没有任何可执行动作，旧会话巡检归属 session-archive 插件。
- 保留迁移核心作为未来导入功能的休眠库：否决——带五个测试文件的 sqlite/线格式死代码是永久的维护税；jsonl.zstd 解码知识保留在退役 note 与 git 历史里。

## 后果

本仓库不再存在回到 RDB 持久层的启用或迁移路径；仍想运行 better-session 的环境对自身 profile 直接安装。旧 jsonl 会话原地保持 jsonl——官方后端拥有存储，既不提供也无需迁移。`/api/dsh-perf/better-session/*` 路由与 `bsm.*` 文案键消失；此前启用动作写进 profile patch 的托管块退化为目标行已不存在的惰性标记注释。dsh-perf 的 npm 载荷减少导入 runner 产物与卡片代码。

## 测试

dsh-perf `pnpm build` 在无导入 runner companion 下重建两半；`vitest run` 在剩余六个文件上 45/45 通过；`tsc --noEmit` 干净。仓库门禁通过：`pnpm typecheck`、`pnpm test`、`pnpm test:scripts`（237/237，含更新后的 i18n-audit 套件）、`pnpm i18n:check`（16 命名空间，1278 zh = 1278 ru 键）、`pnpm docs:check`。
