# Agent Note：将 dsh-fulltext-search 登记进社区插件索引

Status: implemented

## Problem

dsh-fulltext-search（一个 DSH Web GUI 插件，在 better-sidebar 文件管理器里按文件内容搜索会话工作目录）已完成开发，需要一个分发渠道。全家桶仓库从不内嵌第三方插件代码，插件不能作为内嵌资产放进 `packages/`；既有的社区路线是在索引里加一条指向贡献者自己公开仓库的条目。

## Decision

dsh-fulltext-search 已作为社区插件条目登记进 `packages/dsh-community-plugins/community.json`，`category: "tools"`，`repo: https://github.com/termanli/dsh-fulltext-search`。在包真正发布前不填 `npm` 字段。由于 `market/dist/manifest/plugins.json` 由 community.json 派生，已用 `node scripts/market-build` 重新生成市场清单，创意工坊卡片与 dsh-market.com 会列出该插件，用户可用 `dsh plugin add https://github.com/termanli/dsh-fulltext-search` 安装。

## Alternatives considered

- 作为聚合成员收编进全家桶（`packages/dsh-fulltext-search`，用改造分支 `dsh_web_ui_comp`）：否决。改造分支只能在全家桶 monorepo 内构建——它的 tsdown 预设 import 了共享的 `shared/tsdown.client.ts`，且 `lib/` 被 gitignore——独立 clone 无法构建、无法安装。社区路线不需要任何家族包机制。
- 发布 npm 并填 `npm` 字段：延后。插件尚未发布，提前填 `npm` 会把用户指向一个装不上的安装命令。

## Consequences

- 插件保持从其自己的公开仓库安装；家族仓库只携带索引元数据，绝不携带插件代码。
- 条目在维护者合并索引 PR 后才出现在创意工坊与 dsh-market.com。
- 将来若收编进全家桶，可复用保留的 `dsh_web_ui_comp` 分支走文档化的收编流程；届时移除该索引条目即可。
