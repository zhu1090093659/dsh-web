# Agent Note：登记 reasoning-effort 并补充运行时与配置保留说明

Status: implemented

## Problem

`dsh-reasoning-effort` 的社区目录条目没有说明目标 DSH 运行时，用户文档也没有解释思考配置与宿主 Models 页面共享命名空间并会在插件移除后保留。插件迁移到独立仓库后，npm `0.2.0` 与 `0.2.3` 的来源也需要补充可核对的记录。

## Decision

社区目录继续以只收录链接的方式登记 `dsh-reasoning-effort`，并将其放在 `dsh-free-search` 之后，因此生成的创意工坊清单为它分配 rank 45。中英文条目描述都写明运行时下限 `DSH >=0.1.1-rc.2`、已验证的 DSH CLI `0.1.1-rc.2` 与 `0.1.2-alpha.1` cohort store 组合，以及卸载不会自动删除 `llm-pi-ai` 中思考配置的事实。

独立插件以 `dsh.engines.dsh` 声明相同的版本下限。配套 README 说明共享的 `llm-pi-ai` 命名空间、带 revision 的 `settings.mutate` 写入、卸载后可能保留的字段、手动清理与重启步骤，并记录 `0.2.4` 迁移到独立仓库前提供 npm `0.2.0` 与 `0.2.3` 的 `dsh-plugins` 提交。

## Alternatives considered

- 声称兼容所有历史 DSH 版本：不取，因为直接验证的只有上述 CLI 与 cohort store 组合；最低版本声明和证据有意保持更窄、更可核对。
- 卸载时删除插件写入的全部 settings：不取，因为该命名空间与宿主 Models 页面共享，自动清理可能丢失宿主配置；改为披露保留字段和清理步骤。
- 把历史源码复制到独立仓库：不取，因为 `Jamsharden/dsh-plugins` 是 `0.2.0` 与 `0.2.3` 的来源；链接精确提交即可保留署名，不重复复制历史。

## Consequences

- 创意工坊与 dsh-market.com 插件清单会在已占用的 rank 44 之后以 rank 45 展示该条目。
- 插件管理器可以使用发布清单中的 `dsh.engines.dsh` 下限识别不支持的旧运行时，已验证环境也有明确证据可查。
- 移除界面不会删除共享的模型配置；需要清理命名空间的用户必须删除文档列出的字段并重启 DSH Web Host。
- npm 历史来源可通过 `Jamsharden/dsh-plugins` 中的精确提交核对，不再依赖无法验证的独立仓库单提交历史。

## Testing

- `node scripts/community-index` 与 `node scripts/community-index --check` 通过，共 45 条。
- `node scripts/market-build` 已重新生成提交中的清单，`dsh-free-search` 为 rank 44，`dsh-reasoning-effort` 为 rank 45。
- 独立插件通过 JavaScript 语法检查和现有单元测试；完整 dsh-web 门禁的实际依赖状态会在 PR 证据中如实报告。
