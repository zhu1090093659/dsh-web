---
status: implemented
date: 2026-08-24
issue: anrenlx/dsh-web-ui#6
---

# Agent Note：领卡来源声明包裹与来源审计（工单 #6）

状态：已实现

## 问题

ADR 0001 对抗性审核场景 c：冻结卡片文本是延时执行的存储型 Prompt 输入，存储型提示注入可以借卡片指令进入毫无戒备的接手 Agent。看板此前也无法回答"这个冻结是谁写的 / 这张卡是谁领走的"。

## 决策

- `src/host-runner.ts` 导出 `promptText(task)`：续接卡片（带 `freeze` 快照的任务）执行时，任务指令被来源声明强制包裹——冻结时间（ISO）、来源会话（`freeze.frozenBy`，缺失时标"未记录"）与未经人工审查提示，置于显式 开始/结束 标记之间。包裹与 T4 交接前言组合而非冲突：引用前言在前，来源声明随后包住指令。普通任务（无冻结）保持 前言+正文 原样；模板由看板侧生成，且卡片可控文本（prompt/标题正文与 `frozenBy`）经 `escapeProvenanceDelimiter` 中和伪造的 开始/结束 标记串，卡片文本无法提前闭合包裹（审查加固见 `2026-08-24-review-hardening.zh.md`）。
- 来源盖章：`TaskFreeze.frozenBy`（作者会话）与 `ExecutionRecord.initiatedBy`（领卡会话），并在每次打开执行时捕获冻结来源副本（`frozenAt`/`frozenBy`）。`startExecution` 捕获快照来源，后续替换快照无法改写历史。
- 动作 envelope 新增可选 `initiator` 会话 id（有界非空字符串，256 上限；畸形值整体拒绝 envelope）。Host 账本在 create 时将其盖入 `freeze.frozenBy`，update 替换快照时重新盖章（换快照不能沿用旧作者），run/rerun 时记为 `initiatedBy`；cron 打开的执行不带 initiator。initiator 是客户端断言的审计元数据，不构成信任边界——`host-routes.ts` 的 loopback/origin 棚栏仍是权威校验。
- 冻结协议门（`sanitizeFreezeSnapshot` extras）放行可选字符串 `frozenBy`、拒绝非字符串；账本/存储归一化（`parseLedger`、import 白名单）带类型校验地往返 `frozenBy` 与执行审计字段，畸形字段按既有修复策略单独丢弃。
- `BoardController` 在 run/rerun 时把当前会话 id（`sessions.list` 快照）经 `TaskBoardTransport.action(action, initiator?)` 传为发起方；`HttpTaskBoardHostTransport` 将其放入 envelope。任务详情显示冻结来源会话（`detail.freeze.frozenBy`）与每条执行的发起方（`detail.execution.initiator`），双语。

## 备选方案

- 包裹所有卡片（含普通任务）——否决：威胁模型是"冻结文本延时执行"；普通任务 Prompt 由用户在看板 UI 直接撰写，全量包裹只给每次普通执行增加噪音，且模板的冻结来源字段对普通任务无意义。
- 把 initiator 当权威——否决：它与动作同线到达，仅作审计记录不放大任何权限；执行权威仍是权限人工确认门（工单 #5）。
- 同时包裹冻结快照三字段——暂缓：它们已在被包裹的卡片指令上下文内，且 T2 解析器已做污点门（拒绝斜杠命令、脱敏），逐字段再包裹是同一模板的重复。

## 后果

- 声明模板的确切措辞是 Prompt 契约；后续修改是安全的（Host 侧生成、无持久副本），但应保持在 `promptText` 一处。
- cron 触发的执行设计上没有 `initiatedBy`；审计消费方将缺失视为"调度器"。
- 执行来源捕获在打开时快照冻结；之后替换快照，执行记录仍显示它当时运行的来源。
- 浏览器发起的运行携带 Web GUI 的当前会话 id；agent 会话经 loopback HTTP 路径同样可以断言自己的会话 id。

## 验证

`pnpm --filter @linxin666/dsh-client-ui-task-board typecheck/test/build` 通过（285 测试；新增 `tests/claim-runner.spec.ts` 覆盖强制包裹、前言组合顺序、普通任务直通；`tests/claim-provenance.spec.ts` 覆盖 envelope initiator 门、frozenBy 织入/重盖、执行审计捕获、cron 缺席、存储往返、controller 发起方透传；`tests/claim-ui.spec.tsx` 覆盖详情页审计字段）。README 配对更新后 `pnpm docs:check` 通过。
