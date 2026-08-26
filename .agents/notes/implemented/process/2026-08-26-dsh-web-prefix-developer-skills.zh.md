# Agent Note: 开发者技能统一 dsh-web- 前缀

Status: implemented

## Problem

三个 dsh-web 开发者技能以裸名交付——`community-plugin-developer`、`pet-developer`、
`skin-developer`——与用户全局 `~/.dsh/skills` 里的同名安装冲突，也不体现仓库归属。
同目录的兄弟技能已统一使用 `dsh-web-` / `dsh-` 前缀（`dsh-web-release`、
`dsh-web-sdk-compatibility`、`dsh-sdk-upgrade`）。

## Decision

- 目录与 `name:` frontmatter 统一改为 `dsh-web-<name>`：
  `dsh-web-community-plugin-developer`、`dsh-web-pet-developer`、`dsh-web-skin-developer`。
- 同步仓库内全部交叉引用：兄弟技能 `dsh-web-release` 的 whenToUse 文本、三个技能自身
  whenToUse 的排除清单、miku-pet 实现笔记（英中两份）、`scripts/dsh-skin-new` 帮助
  文本里的技能路径。

## Alternatives considered

- 保留裸名、只改面向用户的标题：否决；与全局安装的冲突正是要解决的问题。
- 使用 `dsh-` 前缀：否决；同目录兄弟技能已标准化为 `dsh-web-`。

## Consequences

技能以 `dsh-web-*` 名称被模型调用；旧名下的全局 `~/.dsh/skills` 副本已于改名后删除
（2026-08-26），装载的技能目录只提供改名后的仓库副本。
