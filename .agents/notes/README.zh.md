# Agent Notes

[English](README.md) | 中文

这里只放一类设计文档。**Agent Note（Agent 决策记录）**记录一个影响本仓库的决策或提案——变更背后的 *why* 与 *放弃了什么*，即代码和普通文档承载不了的部分。本文件定义 Agent Note 的存放位置、写作时机与[文件内格式](#文件格式)。

## 目录布局与命名

每个 Agent Note 有两个维度，都编码在路径里——`{lifecycle}/{class}/yyyy-mm-dd-topic-title.md`：

- **生命周期**（顶层目录）是 Agent Note 的状态，状态变化时文件随之移动：
  - **`proposed/`** —— 实现前待评审的提案；尚未实现（或只部分实现）。
  - **`implemented/`** —— 决策已落地。文件记录决定了什么、否决了什么，并与实际交付保持同步：后续工作移动文件、重命名包或修改键与默认值时，在同一变更中更新记录的事实——但绝不改决策本身。见 [implemented/AGENTS.md](implemented/AGENTS.md)。
  - **`rejected/`** —— 提案经评审后被否决；结论写在 `Status:` 行上。只要其理由还能阻止一次可能犯的错误就保留；否则整组三件套一起删除。
- **类别**（嵌套目录）是决策的种类——见[分类](#classification)。

文件名中的日期是主题首次提案的日期（以 git 历史为准）。Agent Note 之间的交叉引用一律用相对 markdown 链接（`[topic](../../implemented/architecture/2026-01-01-topic.md)`）——不用裸文字或编号——保证可机械检查并在目录间移动后仍然有效。活跃的生命周期树就是工作清单：浏览 lifecycle/class 目录或搜索仓库即可，不要维护集中式索引文件。未来价值低的 implemented 记录移入冻结的 [`archived/`](archived/AGENTS.md) 树，详见[归档与删除](#archiving-and-deletion)。

## 分类

每个 Agent Note 恰好属于以下封闭集合中的一个类别目录：

| 类别 | 覆盖范围 |
| --- | --- |
| `feature` | 新的用户可见或模型可见能力。 |
| `bug-fix` | 修复缺陷或补上缺口。 |
| `simplification` | 移除代码、行为或表面面积，不新增能力。 |
| `architecture` | 关于交付源码的结构性决策——包之间如何关联、运行时词汇是什么。 |
| `process` | 围绕代码的工具、策略与工作流——门禁、脚本、发布流程——不是运行时行为。 |
| `testing` | 测试基础设施与测试策略。 |

`architecture` / `process` 的分界线：architecture 针对我们交付的源码；process 针对周边工具与工作流。刻意不设 `refactor`——它与 `simplification` 重叠，后者的判别标准「可观察行为是否变化」已经覆盖它。

## 何时写一条

每个非平凡变更必须在同一变更中新增或更新至少一条 Agent Note。非平凡指：改变行为、架构、跨文件或跨包的契约、流程或工具、测试策略、磁盘 / 传输 / 配置格式，或其他维护者可能合理重新审视的决策。面向未来的大型提案从 `proposed/` 起步；已经做出的决策从 `implemented/` 起步。

更新已拥有该决策的既有 Agent Note 即满足此规则；不要新建重复记录。只有纯机械性、局部且不改变行为、契约、结构、流程或理由的编辑才豁免。Agent Note 绝不会被原地改成另一个决策：用新记录取代它并保持两者互链，除非一次完整合并能保留所有独有的理由、备选方案、后果与必需验证，同时修复所有入链。

每写一条新的 Agent Note 都要做取代检查：先在活跃树中搜索覆盖同一决策或机制的旧记录。

## 文件格式

每条 Agent Note 的前三行严格为：

```markdown
# Agent Note: <title>

Status: <status>
```

`Status:` 取三种形式之一，且必须与所在生命周期目录一致：`Status: proposed`、`Status: implemented` 或 `Status: rejected — <一句话理由>`。状态行不带日期、不带括号补充：日期归文件名，其余归 git。对被否决的记录而言，否决理由正是读者要找的事实。

### 正文骨架

每条 Agent Note 以 `## Problem` 开篇——动机要写到脱离解决方案也能独立成立。重复出现的章节只用这些规范名；真正定制化的技术章节（拓扑、契约、schema）可以自由放在必选章节之间。

`proposed/` 用：`## Problem`、`## Proposal`、定制章节、`## Alternatives considered`、`## Acceptance criteria`、`## Risks`。提案可以用将来时——计划、迁移步骤与开放问题在工作未落地前都写在这里。验收标准说明什么可观察状态算完成；风险覆盖可能出的问题与明知要放弃的东西。

`implemented/` 用：`## Problem`、`## Decision`、定制章节、`## Alternatives considered`、`## Consequences`。决策用现在时描述已交付的现实。规格腔标题——`## Proposal`、`## Plan`、`## Migration plan`、`## Acceptance criteria`——不得出现在这里；陈述现在时事实的 `## Testing` 章节没问题。

`rejected/` 用：保留提案时期的全部章节（含 `## Acceptance criteria` 或 `## Plan`）并冻结；只有头部块、`## Problem` 开篇与备选方案的强制要求适用。

### 备选方案 — 强制

每条 Agent Note 都有 `## Alternatives considered` 章节：每个真实备选方案及其落败原因，每个方案一段。只记决策不记它打败了谁，等于邀请反复翻案。备选方案是记录下来的，不是编造的：无法从记录复原备选方案的前格式遗留记录，在章节位置放这条精确注释代替：

```markdown
<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
```

### 在生命周期之间移动

文件在生命周期目录间移动时，同一变更内必须更新 `Status:` 行并重新满足目标目录的骨架。`proposed/` 到 `implemented/` 要把 `## Proposal` 改写成现在时的 `## Decision`，把验收标准与风险并入 `## Consequences`。`proposed/` 到 `rejected/` 只需在 `Status:` 行加上理由然后冻结文件。

### 中文对应版本

`.zh.md` 对应版本按 [i18n 契约](../../docs/i18n.md)逐节镜像英文版结构；机器校验的头部标记（`# Agent Note: ` 与 `Status:` 行）保持英文原样。每条记录按标准三件套交付——`<name>.md`、`<name>.zh.md`、`<name>.i18n.yaml`——blob hash 用 `git hash-object` 记录在 sidecar 中。

## 归档与删除

当已实现的决策完成交付、其理由不太可能再指导未来工作时归档该记录；当它的备选方案、所有权边界、负面保证、持久语义、安全规则或重新引入条件仍有用时保持活跃。绝不归档 proposed 记录：过时的提案走否决。rejected 记录只在还能阻止一次可能犯的错误时保留；否则英文、中文与 sidecar 三件一起删除。

归档路径编码为 `archived/{class}/yyyy-mm-dd-topic-title.md`；不存在 `implemented` 层级，因为只有 implemented 记录能进入归档。归档变更只允许：移动完整三件套、在每个 `Status: implemented` 行下方插入相同的 `Archived: YYYY-MM-DD` 行、重录 sidecar hash、修复或删除入链。一旦封存，归档记录永久冻结：不得编辑、翻译、重排、移动或删除，也不得当作当前行为的权威。见 [archived/AGENTS.md](archived/AGENTS.md)。
