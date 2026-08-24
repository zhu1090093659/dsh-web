# Agent Note: 发布流程的自动升级兼容性门禁

Status: implemented

## Problem

原发版 skill 描述了版本发布和全新安装检查，但没有要求完整审计用户通过 plugin-manager、Doctor 或直接 CLI 路径升级时的兼容性。它也把旧包双发布描述成有边界的过渡，却没有要求发布时验证窗口，因此兼容迁移可能在文档中被视为安全，而实际管线却可能无限期发布旧包或采用不一致的迁移假设。

## Decision

dsh-web 发版 skill 要求在版本 bump、合入 main、创建 tag 和发布 npm 之前完成自动升级兼容性审计。审计比较上一版本与目标源码和 npm tarball，盘点包身份、profile 与锁文件格式、持久化标识、线协议与 SDK 契约、生成产物以及跨平台生命周期行为，并将每项变化归类为向后兼容、可确定性迁移或阻断发布。

强制验证矩阵覆盖全新安装、上一版本到目标版本的升级、仍受支持的最旧版本和每个 legacy mapping、失败与重试注入、plugin-manager 更新、Doctor 启动前迁移、直接 CLI 的限制以及平台特有行为。迁移变化必须有唯一 owner、明确的旧值到新值映射、幂等事务、备份与回滚路径、先安装目标再验证的步骤，并且失败后不能留下双挂载、重复行、半写锁文件或数据丢失。

该 skill 将旧聚合包更名视为有条件的过渡：只有在发布窗口仍有效且目标包已通过 registry 验证时，才允许双发布 `@linxin666/dsh-web-ui-all`；窗口结束后不再发布旧包，并使用包含迁移指引的 deprecated 标记。发版清单必须与实际管线实现一致，不能假设文档中写了连续两版就代表管线已经自动限制。

家族包数量由 `scripts/lib/family-packages.mjs` 推导，并通过 `node scripts/verify-version.mjs X.Y.Z` 校验；skill 不再手抄固定数量。发版提交明确包含 `.agents/notes/`，确保兼容性决策与 skill、release notes 一起进入发布内容。

## Alternatives considered

- 只把全新安装成功视为充分条件：否决，因为它无法发现影响存量用户的 profile、锁文件、持久化 key 或旧包问题。

- 只要求单元测试：否决，因为更新行为依赖真实 npm tarball、官方 CLI 写入、组合后的 profile、进程生命周期和平台路径。

- 假设旧包会在两次发布后停止，而不在管线中设置门禁：否决，因为文字不能阻止无限发布，也不能证明已经执行 deprecated。

- 通过强制 major 版本阻断所有更名：否决，因为在事务和回滚行为经过验证时，确定性包迁移可以保留现有 profile。

## Consequences

发版准备需要更多强制证据；当某条升级路径未验证时，版本 bump 之前就可能停止发布。维护者必须保持兼容性矩阵、迁移 Agent Note、行为测试、release notes 和管线窗口行为同步。直接执行 `dsh web` 绕过 Doctor 迁移时，仍属于必须明确记录的限制。
