# 梁神模式 V4.1 Flash 评测协议与工具交接（2026-09-13）

一次性交接快照，不进入长期文档。内容为[梁神模式针对 DeepSeek V4.1 Flash 的改进计划](../../../.agents/notes/proposed/feature/2026-09-13-liangshen-v41-flash-improvement-plan.zh.md)第 1–4 阶段落地的评测协议、工具用法与当前状态。

## 状态

工具、契约修复与种子任务集已交付，**尚未运行任何付费会话**。按计划的默认值规则，在证据无法排除退化时落地契约修复并保留当前默认策略（四工具锚定 + 第二回合起 PTC）。本文件不包含真实 A/B 结果。

## 交付物

| 交付物 | 作用 |
| --- | --- |
| `packages/dsh-liangshen/presets/liangshen/tool-catalog.mjs` | 原生目录只宣告该次请求自己 wire 上的工具；PTC 下宣告经 SDK 可达的工具面并声明 `run_code` 是唯一可直接调用的工具 |
| `packages/dsh-liangshen/tools/benchmark-live-run.mjs` | 隔离 preset 副本中的有界运行器：B/P/T/N/M 矩阵、基线记录、任务工作区、Node 验收判分、会话与费用上限 |
| `packages/dsh-liangshen/tools/benchmark-report.mjs` | 汇总：按组成功率与 Wilson 区间、按任务配对差值与置信区间、token 与费用、单独的基础设施失败与超时，且只读取本次 suite 清单内的记录 |
| `packages/dsh-liangshen/tools/tasks/liangshen-v41-flash.json` | 种子任务集（11 个任务，覆盖代码修复、首轮专用工具、多轮修改、失败恢复、工作区指令遵循） |

## 基线与对照矩阵

每次运行记录：仓库提交与 dirty 状态、出厂 preset hash、该变体 preset hash、DSH 版本、固定 route（`deepseek-official/deepseek-flash/max`）、任务版本与 hash、平台与 Node 版本、会话/费用上限，以及实际下发 patch 文本。

| 组别 | 人格提示 | 工具策略 | 对照用途 |
| --- | --- | --- | --- |
| B | 出厂 | 四工具锚定 + 第二回合 PTC | 契约修复后的基线 |
| P | 候选 | 四工具锚定 + 第二回合 PTC | B 与 P 隔离 persona 影响 |
| T | 候选 | 首轮即用 PTC | P 与 T 检查锚定是否有益 |
| N | 候选 | 全程原生工具 | T 与 N 比较呈现方式 |
| M | 官方 Minimal | 官方配置 | 外部参照，不做单因素归因 |

候选 persona 保留身份行，并替换出厂纪律：不禁止推演具体实现、思维循环改为换方法或用工具验证、PDCA 表述为读代码、最小充分修改、验证结果。

## 运行顺序

1. 先跑最多 12 次 smoke 验证协议、结果采集与费用估算：`node tools/benchmark-live-run.mjs --variant B`。
2. 按 smoke 估算确定费用、会话数与时延上限，再跑矩阵：`node tools/benchmark-live-run.mjs --tasks tools/tasks/liangshen-v41-flash.json --groups B,P,T,N,M --repeat 3 --max-sessions 60 --budget-usd 5 --keep`。达到上限即停止，不自动扩样。
3. 汇总：`node tools/benchmark-report.mjs .benchmark-results`，输出 `report.json` 与 `report.md`。
4. 需要语言风格指标时，对 `--keep` 保留的会话日志单独跑 `node tools/analyze-session.mjs <session.jsonl>`；风格指标不进入任务结果。

## 指标与处理约定

- 主指标是独立验收的任务成功率：每个任务由 `node --input-type=module -e <check>` 在任务工作区里判分，退出码为 0 且会话进程正常退出才算通过。
- 同时记录工具错误、人工介入（`ask_user_question` 调用）、审批请求、耗时、token 与费用。
- 基础设施失败仅指"会话日志里没有任何 request"或"没有被判分"的运行：单独记录并从成功率分母中排除。**超时不算基础设施失败**——模型跑过但没在时限内完成，计入任务失败；超时数量在报告中单列，便于区分两种失败模式。
- 矩阵按任务交错运行各组（同一任务的各组在进入下一个任务前跑完），因此会话/费用上限截断的是整块任务臂，不会让排在后面的组得到零会话。
- 报告只读取 `suite.json` 清单记录的运行文件，并拒绝基线不一致（提交、preset hash、route、任务版本）的记录，避免复用结果目录时把旧数据混入统计。
- 配对任务少于 2 个时只报点估计并标注"区间不可估计"，不制造零宽度的"95% 置信区间"。
- 费用上限需要价格表：`--budget-usd` 必须配合 `--prices <file>`（键为该 provider/model 每百万 token 的 `input`/`output`/`cacheRead`/`cacheWrite` 费率），否则 runner 直接拒绝运行，避免无法计价的预算门形同虚设；同时未提供任何上限时会向 stderr 提示矩阵将跑到任务集末尾。
- 相同任务在隔离环境可重复执行：preset 副本写在临时 root 并用 roster 自己的 `roots` 选中，会话持久化改写到运行目录，不追加真实会话历史。
- M 组是官方 Minimal，只作外部参照；N 组是完整原生工具面，不标记为 Minimal，也不是重新筛选的精简工具集。

## 本轮验证证据

- `pnpm --filter @linxin666/dsh-liangshen test`：15 个测试文件、226 个测试通过（含请求面目录契约、变体重写、种子任务在初始工作区必失败、超时计入失败、suite 清单隔离与基线不符拒绝、单任务不产生置信区间、无法计价/费率不完整的预算门被拒绝、任务交错的运行计划）。
- `node --check` 通过两个新工具文件；用合成运行记录跑通 `benchmark-report.mjs`，生成的 Markdown 含分组表、配对比较与处理说明。
- 全仓门禁结果见交付说明；`packages/dsh-liangshen` 插件源码已改动，运行中的 DSH 宿主需重启后新的目录行为才生效。

## 交付时基线快照

| 项 | 值 |
| --- | --- |
| 生产基线提交 | `e3d2b8503bcd0827af7ef7223e0a1192466fb753`（本次改动 rebase 后的父提交，即当时的 `origin/dev`） |
| 出厂 preset 源码 hash | `4cf50f4db4b1520f1f89a081f5441319b8baa17a4c1d01b695db1cbe73aba3e9`（presets/liangshen 全树，sha256） |
| DSH 版本 | `0.1.5-rc.1` |
| 固定 route | `deepseek-official/deepseek-flash/max` |
| 权限 | headless profile 的宿主文件沙箱策略；评测脚本不改动它 |
| 任务版本 | `liangshen-v41-flash-seed` v1，11 个任务 |

运行器在每次运行时重新记录同样的字段（含该变体的 preset hash、平台与 Node 版本、实际下发 patch 文本），因此上表只是本次交付快照，不能替代运行记录。

## 未完成与风险

- 未运行 smoke 与真实 A/B：付费会话需要先获得预算授权。计划要求的费用上限只能由 smoke 实测确定。
- 种子任务集为 11 个任务，主对照前需扩展到计划要求的 20–30 个并逐条评审验收标准。
- 小样本只用于筛选方向；在声称稳定提升之前需在既定预算内扩样。
- Provider 路由与模型更新会改变结果，对照运行需记录日期与 route 并在足够接近的时间内完成。
