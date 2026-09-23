# Agent Note: Workshop accepts agent-preset contribution PRs

Status: implemented

## Problem

外部贡献门禁（`.github/workflows/reject-non-content-pr.yml`、PR 模板、CONTRIBUTING.md、`.github/pr-review-routes.json`）此前只认三类内容贡献：社区插件索引登记、新皮肤收录、新宠物收录。创意工坊随后增加了第四类资产——社区 agent 预设（发布源 `packages/dsh-preset-center/presets/`，进 dsh-market.com manifest）——但门禁仍会自动关闭外部贡献者的预设 PR，模板中也没有任何章节告诉贡献者预设投稿需要包含什么。

## Decision

- 门禁接受第四类内容贡献：agent 预设收录。预设 PR 以正文中勾选的类型行 新预设收录（内容贡献，欢迎直接提交，无需先提 issue） 识别；`reject-non-content-pr.yml` 对其保持打开。
- 分派走既有「插件功能」评审路由：该类别勾选行在包列表中加入 预设中心，同一精确字符串同步进 `.github/pr-review-routes.json`（label 与 types），保证自动分派继续按勾选行匹配。
- PR 模板新增 新预设收录 检查清单，内容来自 `packages/dsh-preset-center/presets/README.md` 的发布契约：目录名 id 规则 `^[a-z0-9][a-z0-9-]*$` 且官方内置 id 保留、`preset.yml` 单行标量、composition 规则（service 行置于带 isolate realm 的 group 内、`!!js` 与本地文件加载须逐项说明）、`catalog.json` 条目（id / author / version）、重新生成 `market/dist` 并过 `market:check`、附本地安装与启用证据。
- 预设是启用后运行在 DSH 宿主进程内的代码，因此模板与 CONTRIBUTING.md 明确评审重点是 composition 实际加载了什么、为什么，而不只是它声称做什么。
- CONTRIBUTING.md 与 ISSUE_TRIAGE.md 将范围改述为四类内容贡献；`scripts/pr-review.test.mjs` 的类别行 fixture 与模板保持同步。

## Alternatives considered

- 仿照皮肤路由新增独立的 预设 / 预设中心 PR 类别：否决，因为 preset-center 与 dsh-pet 一样是插件包，其投稿本就走「插件功能」类别；新增类别只会多一条路由与一行模板，评审人与检查内容都不变。
- 不改模板、靠评审人自行裁量接受预设 PR：否决，因为自动关闭机器人仍会拒绝它们，且与安全相关的 composition 评审需要声明的证据，检查清单收集的正是这些证据。

## Consequences

- 外部预设 PR 勾选类型行后即可通过门禁；门禁的其余行为（文档拒绝、证据规则、维护者豁免）不变。
- 预设评审人拿到固定的证据清单；Workshop 面板的 composition profile 确认仍是运行时同意边界。
- 类别行字符串在 PR 模板、`.github/pr-review-routes.json`、`scripts/pr-review.test.mjs` 三处逐字重复；自动分派按精确字符串匹配勾选行，再次修改必须三处同步。
