# Agent Note: 仓库技能统一由 .agents 技能主目录解析

Status: implemented

## Problem

四个仓库自有技能——`dsh-web-skin-developer`、`dsh-web-pet-developer`、`dsh-web-community-plugin-developer` 与 `dsh-web-release`——放在 `.dsh/skills/`，这是 DeepSeek Harness 会扫描、但共享 `.agents` 指令分层并未指定的项目根。`.agents/skills.json` 仅作为列出 `.dsh/skills` 的桥接存在，因此感知 `.agents` 的工具必须依赖这个旁路文件才能看到这些技能。这种拆分把技能留在某个 harness 专属目录，同时保留了一份唯一条目正好重复标准 `.agents/skills` 根的清单。

## Decision

- 把四个仓库自有技能从 `.dsh/skills/` 移到 `.agents/skills/`，即 `.agents` 分层中的规范项目技能主目录。DeepSeek Harness 会与 `.dsh/skills` 一并原生扫描 `.agents/skills`。
- 删除 `.agents/skills.json`；技能落在默认 `.agents/skills` 根之后，其唯一条目（`.dsh/skills`）即为冗余。
- 把所有活引用指向新根：根 `AGENTS.md` 的发布链接、release 技能的 `git add` 暂存路径，以及 agent-coding 技能的 release 交叉链接。
- 本决策部分取代 [个人开发技能统一由技能主目录解析](../simplification/2026-09-10-personal-skills-canonical-home.md)：删除 vendored 个人副本仍然有效，而其中「`.dsh/skills/` 保留四个仓库自有技能」一条现由本决策解析。

## Alternatives considered

- 技能留在 `.dsh/skills/` 并保留 `.agents/skills.json` 桥接：否决——桥接是为非标准根做的补偿，清单陈旧或缺失就会让仅感知 `.agents` 的工具看不到技能；标准根去掉了这层间接。
- 把 `.dsh/skills` 软链到 `.agents/skills`：否决——软链让同一批文件存在两条路径，还引入监听与规范化面，相比直接移动没有收益。
- 移动技能但保留 `.agents/skills.json`：否决——清单会指向一个已不存在的目录。

## Consequences

- 项目技能对感知 `.agents` 的工具与 DeepSeek Harness 都从唯一根 `.agents/skills/` 解析。
- `.dsh/` 只保留本地未跟踪的探测与 perf 文件；其 `skills/` 根不再存在。
- 发布流程改为暂存 `.agents/skills/` 而非 `.dsh/skills/`，发版提交会包含新位置的技能改动。

## Testing

- `git status` 报告四个重命名 `.dsh/skills/<name>/SKILL.md -> .agents/skills/<name>/SKILL.md` 及 `.agents/skills.json` 的删除。
- 所有改动的相对链接都能在磁盘上解析，且 `pnpm docs:check` 通过。
- 全仓搜索 `.dsh/skills/`：被移动的技能已无活目标；其余匹配为冻结的 `docs/archive` 快照、release notes 与决策记录。
