# Agent Note：续接卡片数据面（工单 #4）

状态：已实现

## 问题

ADR 0001 的续接卡片需要第一条完整垂直切片：看板能创建携带冻结上下文快照（目标/进度/下一步）的卡片、在 v3 账本中持久化，并与普通任务一致地展示/搜索/归档/恢复。会话内冻结生成入口（由会话产出冻结块）明确不在本工单范围；本工单只做数据面。

## 决策

- `TaskRecord` 增加可选 `freeze?: TaskFreeze`（`goal/progress/next/frozenAt/redacted?`）。`NewTaskInput.freeze` 携带已过门的快照；create/update 用例用各自的 `now` 时钟经共享 `freezeOf` 助手打 `frozenAt`。
- `core/freeze-snapshot.ts` 的 `sanitizeFreezeSnapshot` 把 T2 安全门暴露给结构化载荷：精确键检查、字符串字段、以 / 开头命令行整体拒绝、敏感模式脱敏（幂等）、每字段 8 KiB 字节上限。`parseFreezeRequest` 仍是自由文本入口；两者共享同一组门函数。
- `protocol.ts` 在 `create` 输入与 `update` patch 上接受 `freeze`（update 用 `null` 清除，因为 JSON 序列化会丢弃 `undefined` 键）。门在 envelope 解析器内执行，脱敏后的快照原地替换线上值，Host 账本只会存过门文本。
- `store.ts` 在每次账本读取（导入与磁盘）时重新归一化 `freeze`：畸形或被污染的快照只丢弃快照本身，绝不丢任务行，与 schedule 修复策略一致。
- UI：新建任务弹窗增加可选冻结块文本域（客户端用 `parseFreezeRequest` 解析；畸形块阻断提交）、卡片冻结徽标、详情页快照区块（冻结时间 + 脱敏警示）、搜索覆盖快照文本。
- `TaskBoard.tsx` 的 `matchesFilter` 导出供测试使用。

## 备选方案

- 存原始冻结块文本、读取时再解析——否决：账本会持久化未过门文本且每个读者都要重跑解析器；在写入缝一次性过门，存储形态即权威。
- 单独的卡片 kind/type 字段——本工单否决：`freeze` 的存在已能区分续接卡片；类型联合会扩张 schema 而没有新行为。
- update patch 用 `undefined` 清除快照——否决：JSON 序列化丢弃 undefined 键，清除指令过不了 HTTP 线；`null` 可往返。

## 后果

- `frozenAt` 由 create/update 用例时钟打点而非客户端，冻结时间与 Host 一致。
- `redacted` 标志是 UI 中的提示性文案，不是信任边界；脱敏本身已在写入时发生。
- 会话内冻结生成入口（agent 产出 `<<<FREEZE` 块进卡片）仍开放，连同 ADR 0001 的交接包，是自然的下一张工单。
- 账本导入（`import` action）经同一归一化接受冻结快照，导入的 v1 浏览器备份已可携带它们。

## 验证

`pnpm --filter @linxin666/dsh-client-ui-task-board typecheck/test/build` 通过。新增 `tests/continuation-card.spec.ts`（9 项测试）覆盖协议门（原地脱敏、命令行拒绝、字节上限、形状）、action -> controller -> ledger -> 磁盘读回垂直链路、update/清除、归档/恢复一致性、筛选覆盖快照文本；全量套件保持 253 通过。
