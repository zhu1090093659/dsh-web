# Agent Note: Agent Notes decision-record tree

Status: implemented

## Problem

设计决策与其被否决的备选方案只存在于提交信息、PR 讨论和散落的交接文件里，未来工作时无法在原地找到结构选择背后的 *why*，被取代的理由也不断被重新翻案。

## Decision

本仓库采用 deepseek-harness 风格的 Agent Notes 树，位于 `.agents/notes/`：生命周期目录 `proposed/`、`implemented/`、`rejected/` 与冻结的 `archived/` 树，每条记录路径编码为 `{lifecycle}/{class}/yyyy-mm-dd-topic-title.md`，类别为封闭集合 feature / bug-fix / simplification / architecture / process / testing。每个非平凡变更在同一变更中记录或更新一条 Agent Note；记录按仓库 i18n 契约以英文/中文/sidecar 三件套交付；根 AGENTS.md 的 Development Workflow 与 Instruction Layers 路由到 [.agents/notes/README.md](../../README.md)，dsh-web-ui-agent-coding skill 携带同一规则。

本次采用以纪律执行为主：尚无专门的格式门禁脚本。

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->

## Consequences

代价是每个非平凡变更多写一份文档，以及缺少机器门禁时记录漂移的风险；收益是可沉淀的理由、强制的备选方案记录、以及任何新决策前的机械取代检查。既有的精修鲸鱼注册表扁平记录随本变更移入 [implemented/feature/2026-08-19-refined-whale-registry.md](../feature/2026-08-19-refined-whale-registry.md)。
