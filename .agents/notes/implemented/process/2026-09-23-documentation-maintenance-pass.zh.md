# Agent Note: 2026-09-23 文档维护运行——对齐家族包清单与内置皮肤数量，并归置一次性记录

Status: implemented

## Problem

`zhu1090093659/dsh-web` 的一次定期文档维护，请求包含五部分：对照 [scripts/lib/family-packages.mjs](../../../../scripts/lib/family-packages.mjs) 核对 21 个家族包、其版本与 `docs/publish-prep.md` 清单；核对长期文档与它们描述的代码是否一致，并点名了内置皮肤数量与 SDK cohort 两个例子；找出 `docs/` 或仓库根目录下的过时草稿、一次性记录与临时调研，按 [docs/AGENTS.md](../../../../docs/AGENTS.md) 归入 `docs/archive/`；运行文档与规范门禁；并逐个提交仅涉及文档的改动，只暂存本任务文件。

本轮开始时存在四处漂移。`docs/publish-prep.md` 仍有 23 处写着 `0.3.23`，而所有包与根聚合包都已是 `0.3.24`。`docs/architecture.md` 写着 38 个内置皮肤，而 `packages/skins/skin-center/skins/` 下有 42 个目录，`market/dist/manifest/skins.json` 列出同样的 42 个 id，`pnpm skin-center:check` 也报告 42 个目录皮肤。两份 LiangShen V4.1 记录——2026-09-16 加入的呈现重构记录与 2026-09-21 加入的 Flash 优化记录——仍作为一次性设计记录留在长期 `docs/` 树里。此外 `docs/pr-evidence/` 下有 24 张 2026-08-16 至 2026-09-19 间加入的、已跟踪的验证 PNG，而这个目录并不被文档契约允许与长期文档并列。

## Decision

家族包清单与承载版本号的事实一律以代码为准修正，而不是以旧文本为准。

- `docs/publish-prep.md` 把 23 处 `0.3.23` 全部改为 `0.3.24`（版本说明行、21 行表格、以及固定版本号的命令一行）。没有新增或删除任何包：`node scripts/verify-version.mjs 0.3.24` 报告 21 个包与根聚合包全部匹配 `v0.3.24`，而发布准备清单本就恰好列出这 21 个。
- `docs/architecture.md` 把内置皮肤数量从 38 修正为 42，覆盖承载该数字的两处——正文句子与 mermaid 节点——并用三种相互独立的计数复核：42 个 `skin.json` 目录、42 个 manifest id、以及 `skin-center:check` 的输出。相邻 mermaid 中 `19 个家族子包` 的说法经复核后保持不变：`packages/dsh-web-all/aggregate.yml` 恰好列出 19 条 `patchFrom`（`packages/` 下 18 个包加 `skins/skin-center`），而 21 个家族包中不在该列表里的正是 `dsh-web-all` 与 `dsh-client-ui-session-id` 两个。
- 两份 LiangShen V4.1 记录用 `git mv` 移入 `docs/archive/`，因此 git 仍将其识别为重命名。只改写了移动本身会导致失效的内容：社区反馈记录中父级相对链接加深一层（`../packages/` 改为 `../../packages/`，`../.agents/` 改为 `../../.agents/`），以及引用它们的两份 Agent Note 对里反引号写法的入站引用，由 `docs/liangshen-v41-*.md` 改为 `docs/archive/liangshen-v41-*.md`。Flash 记录没有父级相对链接，保持逐字节不变。
- 24 张 PR 证据 PNG 移入 `docs/archive/pr-evidence/`，与原有的 11 张合并，随后删除已空的 `docs/pr-evidence/` 目录。其中一份 Agent Note 对——wallpaper-exclusive better-sidebar 包含块缺陷记录——更新为「PR 证据图归入 `docs/archive/pr-evidence`」，而不再表述为仍留在 `docs/pr-evidence`。
- 每份因移动而被触及的笔记对，其 `.i18n.yaml` 边车都用新的 `git hash-object` 值重新记录，因为边车才是「两侧一致」这一判断的可机械校验表述。本轮共更新三对。
- 冻结的归档记录一律不动，包括 `docs/archive/pr-task-board-execution-targets.md`（其中写着一个从未提交过的 `docs/pr-evidence/…png` 路径）与 `docs/archive/pr-review-1601-wallpaper-exclusive-workbench.md`（其「PR 证据图宜落在 `docs/archive/pr-evidence/`」的建议正是本轮所实现的）。归档笔记是快照；本轮让现实去符合建议，而不是改写历史文本。
- 根目录的临时材料保持原位。`REVIEW-PROMPT.md`（2026-08-14 的一份评审请求，针对 0.1.3–0.1.5 区间）被 [.gitignore](../../../../.gitignore) 忽略、没有任何入站引用、也没有已跟踪的对应物，因此把它移进文档树不会产生可提交的改动；`gui-test-screenshots/` 与 `test-results/` 同样被忽略。删除本地临时数据并不在文档维护请求的授权范围内。

本轮在 `dev` 上落为四个文档提交——`f8e26404`、`72231df6`、`cc5912a5`、`655ebdf9`——并由本笔记记录该次维护，均未推送。

## Alternatives considered

本可以按日期拆分 `docs/pr-evidence/`，把最近的截图留在 `docs/` 当作「当前证据」，其余归档。否决：契约没有给 `docs/` 任何「较新即豁免」的例外，24 张图都是同一类随 PR 附上的一次性验证快照，而基于日期的拆分需要一条没有归属文档的规则。

本可以把两份 LiangShen 记录改写或改标题以标出其已归档。否决：归档即「移动并冻结」，移动只能带来那些否则会破坏链接或已记录事实的改动。

本可以就地修正 `docs/archive/pr-task-board-execution-targets.md` 里的过时路径提及与 `docs/archive/pr-review-1601-wallpaper-exclusive-workbench.md` 里的建议。否决：归档记录是冻结的历史快照，本轮宁可留下这处观感上的过时提及，也不为一个从未提交过的路径改写历史。

本可以整批重审七份长期文档，把所有版本字符串都从 `package.json` 重新生成。按 YAGNI 否决：本轮只核对请求点名的具体断言以及版本升级可能证伪的断言，其余文档（`plugins.md`、`development.md`、`telemetry.md`、`i18n.md`、`multi-agent-resources.md`、`AGENTS.md`）既不含皮肤数量也不含过时 cohort 说法。

本可以把这份记录并入同一共享检出里并发进行的第十九轮 PR 维护笔记。否决：那份笔记拥有的是「把外部 PR 对齐到 `dev`」这一不同决策、不同归属，共用 slug 会让两次无关的维护看起来像同一份记录。

## Consequences

`docs/` 现在只包含长期文档（`AGENTS.md`、`architecture.md`、`development.md`、`i18n.md`、`multi-agent-resources.md`、`plugins.md`、`publish-prep.md`、`telemetry.md`）以及资产目录、`release-notes/` 和 `archive/`；本轮找到的每一份一次性记录都在 `docs/archive/` 下有归属。被移动的 LiangShen 记录的读者通过归档路径抵达它们，入站引用与配对边车与新位置一致。

代价是：为让被移动路径与配对哈希保持真实，三份 Agent Note 对在其自身主题之外被改动；今后再移动一份归档记录会有同样的连带范围。门禁并未堵上这一点：`pnpm docs:check` 不扫描 `.agents/notes`，因此配对边车与笔记链接深度只靠约定，本轮为人工核对；也没有门禁把正文里的内置皮肤数量与目录做比对，因此 `docs/architecture.md` 若退回旧数字也不会让 CI 失败。这一漂移类别——没有门禁拥有的文档事实——仍是本轮点名的覆盖缺口。

## Testing

改动后运行了整套文档与规范门禁，每个门禁都以 0 退出。

- `pnpm docs:check`：`verify-docs: all documentation gates passed`。
- `pnpm i18n:check`：`[i18n-audit] OK: 17 namespaces, 1435 zh keys, 1435 ru keys, 2 exemption(s), 41 host-half warning(s)`。
- `pnpm emoji:check`：`[emoji-audit] OK: 3053 hand-written file(s) scanned, no pictographs`。
- `pnpm aggregate:check`：`check OK: packages/dsh-web-all (20 row(s), 19 dep(s), 16 client child(ren))`。
- `pnpm market:check`：`tryon/ verified against hash manifest (756 files)` 与 `dist up to date (3230 files)`。
- `pnpm skin-center:check`：`check OK (42 repo catalog skins; package ships blue-fantasy only)`。
- `pnpm libs:check`、`pnpm community:check`（119 条）、`pnpm sync-shared:check`、`pnpm runtime-deps:check`（4 个扫描包）全部通过。
- 移动完整性：两次归档移动后 `git status` 都把被跟踪文件显示为重命名，`docs/pr-evidence/` 无剩余条目，并再次跑绿同一 `pnpm docs:check` 门禁。

未验证：未做任何 GUI 或渲染行为验证，因为本轮只改文档。没有任何推送，因此 `origin/dev` 尚未包含这些提交。`.agents/notes` 下的配对与链接规则由人工核对与 `git hash-object` 校验，而非由门禁校验。冻结的 `docs/archive/pr-task-board-execution-targets.md` 中那处过时 `docs/pr-evidence/…png` 提及是明知而保留的。