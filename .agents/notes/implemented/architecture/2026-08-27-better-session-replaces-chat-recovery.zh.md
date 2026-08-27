# Agent Note: 分支式会话编辑切换到外部 better-session；dsh-chat-recovery 退役

Status: implemented

Supersession check：没有活跃 Note 拥有会话编辑能力策略。[task-handoff-issue-316-edit-retry](../../../docs/archive/task-handoff-issue-316-edit-retry-2026-08-17.md)（archive）是 chat-recovery 的诞生记录、属冻结历史。2026-08-24 dock-chrome 与 2026-08-25 workshop-fixes 两篇 bug-fix Note 对 chat-recovery 的提及只是无关主题里的过去时修复记录，原样保留。

## Problem

dsh-chat-recovery 与上游 [morlay/better-session](https://github.com/morlay/better-session) 在同一用户面重叠（编辑历史消息、重试回合），深度不同：

- chat-recovery 设计上只能 fork：每次编辑在受影响消息之前切子分支，只有最后一条完整 user 消息可编辑，retry 只针对失败回合，反复重试会留下客户端无法删除的陈旧子会话尾巴。
- better-session 基于 RDB 实现真正的就地编辑（替换 `ctx.sessionPersistence`）：edit / reroll / retry / rewind 重写同一会话 id，只有 fork 派生新 id，且打开中的会话支持就地回退。delta 内容不落库，事件稠密重编号。

2026-08-27 已获上游作者（morlay）同意内置。两插件并存会重复入口与渲染 shadow（`conversation.chat.node`、turn-tail 按钮），fork 式插件必须移除。

## Decision

- 接入遵循 `dsh-better-sidebar` 与 `@mlgbnb/dsh-archive-manager` 的既有外部集成模式：消费上游 **npm 包**（`@morlay/better-session@0.0.11`，registry 可读，SDK 版本批次与 rc.2 兼容），在 `packages/dsh-web-all/package.json` 固定版本；源码不入库。
- 聚合清单（`aggregate.yml`）新增外部行 `{"id": "better-session", "name": "@morlay/better-session"}`，渲染在全部 patchFrom 块之后——插件的持久化 rewiring 在 jsonl 调优行之后应用；重新生成产物并提交。MIT 许可在双语版权节登记。
- 由于 `@morlay/better-session` 以 profile bundle 形态发布（其 `dsh.bundle.patch` 插入可导入子插件），聚合生成器展开 bundle 行：`dsh-better-sidebar`、`@mlgbnb/dsh-archive-manager`、`@morlay/better-session` 的 patch 行都汇入 `cordis.patch.yml`，插入行 id 保持 `web-ui-*` 命名空间，bundle 自身的 harness-row patch（如禁用 `session-persistence-jsonl`）原样保留。`link-profile.mjs` 同时把 bundle 子包链接进 profile 层，让聚合行能从 profile 顶层解析它们。
- `packages/dsh-chat-recovery/` 整体删除，含聚合清单条目、telemetry 同步目标与 publish-prep 行（家族包数 19 -> 18）。
- 提及 chat-recovery 的历史记录（release notes、archive 快照、过往修复 Note）保持冻结；社区索引从未登记过它。

## Alternatives considered

- **把 better-session 源码移植进 packages/**：否——维护者的约定是接入的第三方插件一律使用其发布的 npm 包；移植三个包（约一万行、带针对持久化内部的契约测试）等于另设一处维护点且立即偏离上游。
- **双插件并存**（better-session 管 edit/retry/rewind，chat-recovery 留监督器 UI）：否——重复的 conversation.chat.node shadow 与 turn-tail 槽位让渲染翻倍、入口混淆；「失败轮次显式一键重试并提示会分叉」这个监督生态位被更安全的就地 retry 覆盖。
- **为非聚合安装保留 chat-recovery**：否——该包不再有独有能力；独立用户直接装 `@morlay/better-session` 即可。

## Consequences

- 全家桶加载 better-session 后存储面改变：其 bundle patch 把 `ctx.sessionPersistence` 从 `$DSH_HOME/sessions/` 下的 jsonl 文件换成 `$DSH_HOME/sessions/sessions.sqlite`。**没有迁移工具链**：既有 jsonl 会话对新后端不可见（仍留在原文件里）；升级全家桶的用户必须在公告里显著告知。（同日更新：该集成本身改为默认关闭并附带 jsonl 导入器——见 [better-session-default-off-and-jsonl-import](2026-08-27-better-session-default-off-and-jsonl-import.md)。）
- 编辑语义增强：就地重写让每个会话保持单一 canonical log，无陈旧子会话堆积；首轮消息编辑不再退化为空白新会话。
- 单会话单写入者守卫：多进程共享同一 sqlite 库时对同一会话的并发写入 fail loud，不同会话的并发写不受影响。
- 性能治理联动变化：jsonl 行被替换后，dsh-perf 复述的 jsonl 写批次行不再生效；其观测/降载两半仍然有效，PerfMeter 正好用作 jsonl 与 rdb 写行为的 A/B 测量工具。
- 固定上游版本意味着后续破坏性变化走外部依赖升级的批次评审路径。

## Testing

- 重新生成后 `node scripts/aggregate.mjs --check` 通过（19 行 / 17 依赖）；产物 diff 已核对。
- `pnpm docs:check`、`pnpm test:scripts`（102 条拷贝项、client 三件套 42）、残留引用 grep 通过；release-assets fixture 改用现存包名。
- 工作区 typecheck 与 vitest 作为合入前证据；运行时验证需以重建后的 profile 重启 `dsh web`（见交付报告说明）。
