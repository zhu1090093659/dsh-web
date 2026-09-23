# Agent Note: 个人开发技能统一由技能主目录解析

Status: implemented

## Problem

`.dsh/skills/` 里留着两份个人开发技能的副本：`dsh-sdk-upgrade`（含 `scripts/profile-cohort-check.sh`）与 `dsh-web-sdk-compatibility`。两者都重复了 `~/.agents/skills/` 下的权威副本——全局指令分层把该目录定为个人指令、技能与工作流脚本的家。副本已经漂移：`dsh-web-sdk-compatibility/SKILL.md` 与 `profile-cohort-check.sh` 同个人副本逐字节相同，而仓库里的 `dsh-sdk-upgrade/SKILL.md` 比个人副本更旧（桌面运行时宿主下限面、强制全量重推导与 `pnpm test:desktop` 只存在于个人副本）。`scripts/rollout-verify.sh` 早已把委托路径改为 `$HOME/.agents/skills/dsh-sdk-upgrade/scripts/profile-cohort-check.sh`，因此仓库副本是随时可能被浏览项目技能根目录的 agent 加载到的死重。

## Decision

- 删除 `.dsh/skills/dsh-sdk-upgrade/`（两个文件）与 `.dsh/skills/dsh-web-sdk-compatibility/`；`dsh-sdk-upgrade`、`dsh-sdk-compatibility` 由 `~/.agents/skills/` 解析。
- `.dsh/skills/` 保留四个仓库自有技能：`dsh-web-skin-developer`、`dsh-web-pet-developer`、`dsh-web-community-plugin-developer`、`dsh-web-release`。它们描述本仓库的包、生成器与发布管线，必须随仓库一起版本化。
- 不更新任何文档或脚本：唯一指向个人技能的活引用（`scripts/rollout-verify.sh`）本就写的是个人路径，并保留找不到时告警跳过的回退。

## Superseded in part

「`.dsh/skills/` 保留四个仓库自有技能」一条由 [仓库技能统一由 .agents 技能主目录解析](../process/2026-09-14-repository-skills-agents-home.md) 取代：这四个技能现位于 `.agents/skills/`。本决策其余部分仍然有效。

## Alternatives considered

- 让仓库副本与个人技能保持同步：否决——个人技能按自己的节奏演进，vendored 副本只会变旧，而升级技能已经旧了。
- 把四个仓库自有技能也移进个人主目录：否决——它们的内容是仓库专属的，必须与其描述的代码一起版本化。

## Consequences

- 会话列项目技能时不再看到第二份更旧的升级工作流副本；个人技能主目录是唯一事实源。
- 仓库不再 vendor `profile-cohort-check.sh`；在没有个人技能的机器上 `scripts/rollout-verify.sh` 会告警跳过该项检查，这与既有行为一致。

## Testing

- 删除前的内容比对：`dsh-web-sdk-compatibility/SKILL.md` 与 `dsh-sdk-upgrade/scripts/profile-cohort-check.sh` 同个人副本完全相同；`dsh-sdk-upgrade/SKILL.md` 的差异全部是个人副本独有的新增内容。
- 应用删除后的树上 `pnpm test:scripts`（270 通过、0 失败）与 `pnpm docs:check` 均通过。
- 全仓搜索 `dsh-sdk-upgrade` 与 `dsh-web-sdk-compatibility`：除冻结归档、release notes 与 `scripts/rollout-verify.sh` 的个人路径委托外，没有任何活引用。
