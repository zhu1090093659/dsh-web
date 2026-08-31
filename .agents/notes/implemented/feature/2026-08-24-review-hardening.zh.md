---
status: implemented
date: 2026-08-24
issue: anrenlx/dsh-web-ui#1
---

# Agent Note: 审查加固 —— import 确认门绕过与来源声明定界串伪造

Status: implemented

## 问题

对 `82a9bb45...6621323a` 的双轴审查发现已交付安全补丁的两个对抗性漏洞：

- CRITICAL（场景 b）：`protocol.ts` 的 `importedTask` 原样透传 `permissionConfirmedAt`，构造携带 `handover.permission: "danger-full-access"` 加伪造确认戳的 `dsh.taskBoard.v1` 导入（或线上 `import` 动作）即可落地为已确认的高权卡——`run`/`rerun`/cron 全放行，整体绕过 T4 confirm-permission 门。
- HIGH（场景 c）：`host-runner.ts` 的 `promptText` 用纯文本 `来源声明 开始/结束` 包裹冻结卡文本，但卡片可控正文（prompt/标题）与 `freeze.frozenBy` 未转义——卡片文本内嵌 `来源声明 结束` 可提前闭合未经审查警示区，让注入内容脱离警告语境。

## 决策

- `importedTask` 不再携带 `permissionConfirmedAt`：该字段在 import 时无条件剥除。import 不是人工确认动作，高权绑定导入后重新武装确认门（import 后 `requiresPermissionConfirmation` 返回 true，直到 `confirm-permission` 执行）。行为落在 `protocol.ts`，注释标明对应对抗场景 b。
- `promptText` 把卡片可控字符串（`body`、`freeze.frozenBy`）经 `escapeProvenanceDelimiter` 处理：将 `来源声明 开始` / `来源声明 结束` 中的空格替换为间隔号（`来源声明·开始` / `来源声明·结束`）。内容保持可读，但真实定界串无法再被伪造；模板自己的收尾标记是输出 prompt 中唯一的字面出现。
- 琐碎卫生：`src/core/freeze-snapshot.ts` 补上缺失的文件尾换行。

## 备选方案

- 携带 `permissionConfirmedAt` 的 import 直接整体拒绝——否决：剥除在可用性上严格更优（旧导出可往返）且安全性等同；拒绝只会破坏浏览器导出/导入，无安全收益。
- 对卡片文本逐字符做 unicode 转义——否决：破坏正常内容的可读性；定向的定界串中和恰好消除伪造能力。
- import 同时丢弃 `frozenBy`/`initiatedBy`（审查发现 H2）——延后至规格级工单：这些字段已文档化为客户端断言的审计元数据，不构成信任边界；让来源可信需要 Host 签名归因（先改规格）。

## 后果

- 重新导入导出的看板会丢失高权卡上的确认戳；每张卡需人工再确认一次。这是封死绕过的预期代价。
- 来源声明模板仍是单点 Host 侧 prompt 契约（`promptText`）；间隔号形式仅存在于渲染输出，不改变任何持久化数据。
- 未决跟进已拆新工单：可信来源归因（H2，规格变更）与 legacy 本地模式 `confirmPermission` 路径（H3，中危）。

## 验证

TDD 红绿：两个对抗性测试先写并在原代码上失败（RED），修复后通过。`pnpm --filter @linxin666/dsh-client-ui-task-board typecheck/test/build` 通过（287 项测试；`tests/continuation-card.spec.ts` 覆盖确认戳剥除与门重武装，`tests/claim-runner.spec.ts` 覆盖定界串中和与注入滞留包裹内）。`pnpm docs:check` 通过。`2026-08-24-handover-confirmation-gate(.zh).md` 与 `2026-08-24-claim-provenance-wrap(.zh).md` 的受影响事实已在同一变更中更新。
