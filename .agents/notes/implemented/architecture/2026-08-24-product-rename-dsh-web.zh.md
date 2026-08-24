# Agent Note: 产品名从 dsh-web-ui 更名为 dsh-web

Status: implemented

## Problem

产品名 dsh-web-ui 的 -ui 后缀冗余，且产品族已不止 UI 插件（Workshop 商店、皮肤管线、远程访问工具），名字不再匹配定位。更名牵涉四个可逆性完全不同的层面：GitHub 仓库 slug、文档与展示文案、已发布的 npm 聚合包名、持久化到用户 profile 的运行时标识符。把更名当成一次原子字符串替换会破坏存量 profile 并让已发布包成为孤儿。

## Decision

产品在展示层与源码层更名为 dsh-web，同时冻结全部运行时、线协议与存储标识符：

- 已更名：GitHub 仓库 slug zhu1090093659/dsh-web（旧 URL 自动重定向）、聚合包目录 packages/dsh-web-all 及其 npm 名 @linxin666/dsh-web-all、settings 包目录 packages/dsh-web-settings（其已发布 npm 名 @linxin666/dsh-client-ui-web-ui-settings 不变）、shared 工作区包名 dsh-web-shared（private，从不发布）、七个仓内 skill 目录 dsh-web-*、docs/dsh-web-banner.png，以及冻结历史之外的全部文案/URL。
- 因持久化在用户 profile 或线协议上而冻结：web-ui-* cordis bundle id 命名空间（聚合 19 行）、dsh-web-ui-market 设置分区 id、/api/dsh-web-ui-settings 桥接路径与 x-dsh-web-ui-settings-proxy-token 请求头、dsh-web-ui-telemetry-visitor / dsh-web-ui-telemetry-day localStorage 键。
- 因属于历史或外部而冻结：docs/archive/、docs/release-notes/、.agents/notes/archived/、JAVA-LW/dsh-web-ui 分叉引用、本地文件系统路径 /Users/zcl/code/dsh-web-ui（本地 checkout 目录保留原名）。
- npm 迁移：下一个 tag 发布并排发布 @linxin666/dsh-web-all 与最后一个 @linxin666/dsh-web-ui-all 版本，随后旧名 deprecate 并附指引文案。双发维持两个版本后旧包停更。不做 shim 壳包：聚合包内含运行时兼容代码，其挂载语义无法经 re-export 保留。
- 按文档标准，docs/ 与 README 对只描述当前名字（不叙述更名史）；迁移故事记录在本 note、提交与更名当版的 release notes 中。

## Alternatives considered

- 仅展示层更名（仓库 + 文档，npm 名不动）：被否决，因为安装入口也是品牌门面，npm 聚合包名是用户明确的迁移目标。它仍是回退底线：所有冻结标识符保证本改动在展示层可逆。
- 含运行时标识符的全量更名（web-ui-* bundle id、分区 id、遥测键）：被否决。这些字符串存在于每个已安装 profile 与浏览器存储中，改名需要永久保留迁移兼容层，收益仅为标识符美观，而迁移 bug 的直接表现是用户插件丢失或设置重置。
- 换一个不与 dsh web CLI 同形的新名字：未采纳；命名权在用户，且已选定 dsh-web。文案约定缓解同形混淆：散文用带空格的 "DSH Web" 作显示名，dsh-web 只用于 slug/URL，且产品族永远表述为官方 DSH Web GUI 的社区插件，而非官方 dsh web 命令本身。

## Consequences

- 存量安装零迁移继续可用：bundle id、分区 id、API 路径与存储键逐字节不变，升级的 profile 照常解析。
- 仓库 slug 与 npm 安装命令和冻结的标识符词汇不一致；读者在 profile 里见到 web-ui-* id 时不要「修正」它们——上面的冻结清单是权威。
- 旧 npm 包名永久可解析（有下载量的包名无法删除）；deprecate 指引是唯一的迁移通道。
- 验证：更名提交上 pnpm typecheck、pnpm test、pnpm docs:check、pnpm test:scripts 与 aggregate/gallery/market/skin-center 四项检查全部通过；market/dist 与 gallery/ 产物由各自构建器重新生成，非手工编辑。
