# Agent Note: 压缩 Agent 工作流指令文件以节省 Token

Status: implemented

## Problem

每次会话都要加载的 Agent 工作流指令——用户层全局文件 `~/.dsh/AGENTS.md`（软链为 `~/.zcode/AGENTS.md`）、`~/.dsh/skills/` 下的 DSH 工作流 skill、`~/.agents/skills/dsh-parallel-dev` 与 `~/.codex/AGENTS.md`——在多次合并中积累了大量重复：三段并行的 Mem0 指引、同一套工作方式规则的中英文双份表述，以及 `pr-issue-maintenance` 与 `existing-feature-improvement` 之间约 9 KB 逐字重复的公共块。这些文本在每次会话启动时都要支付成本，包括定时运行 `pr-issue-maintenance` 的维护自动化。

## Decision

用户层文件原地压缩，逐条保留语义，原始文件备份于 `~/.dsh/backup-tokenopt-20260828/`。`~/.dsh/AGENTS.md` 把 Mem0 与工作方式的重复段落合并为单节；`pr-issue-maintenance` 与 `existing-feature-improvement` 把共享块（Git 前置要求、事实基线与并发、评论与回复规范、队列与 worktree 纪律、合并闸门、类型通道、协作者已审查不重复审查）抽到共享文件 `~/.dsh/skills/pr-issue-maintenance/pr-review-common.md`，两个 skill 都强制在评审或合并动作前完整阅读；其余 skill 收紧行文但保留每条规则；删除指向已移除的 `dsh-upstream-customization` 与 `dsh-snapshot-upgrade` 的悬空引用。用户层文本总量从约 85 KB 降到约 62 KB（含新共享文件）。本仓库内，根 `AGENTS.md` 把两条 CodeGraph 工作流规则合并为一条并去掉重复的 Agent Note 规则链接；`packages/AGENTS.md` 与 `docs/AGENTS.md` 保持不变——它们已达到本仓库要求的「一个事实一个家、每条 1-3 行」密度。

## Alternatives considered

重写共享池里的第三方 skill（`hyperframes*`、`cloudflare`、`wrangler`、`media-use` 等安装包）被否决：其措辞就是上游的触发面与契约面，改动会在更新时被覆盖，也无法在本机验证。把中文治理规则翻译成英文以省字节被否决：翻译会让评审约束规则产生语义漂移风险，且无结构性收益，因此各文件保持原语言。只裁剪仓库文件、跳过用户层被否决：用户层文本跨所有项目在每次会话加载，才是重复的真正所在。

## Consequences

常驻工作流文本缩减约四分之一，未删除任何规则；两个维护 skill 的评审纪律现在共享同一事实源，规则修改一次即同时作用于两个工作流。运行任一维护 skill 的 Agent 需在行动前阅读共享公共文件，每次调用多一次读取。两 skill 此前分歧的评审规则统一采用更严格的超集，例如协作者审查后新增提交的跟进归属。压缩后的措辞仅在新启动的会话中生效。
