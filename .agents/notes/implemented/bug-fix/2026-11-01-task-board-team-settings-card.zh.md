# Agent Note: 任务看板团队协作的设置区块改渲染为嵌套设置卡

Status: implemented

## Problem

团队协作提供方的配置区块是看板自己设置卡里的最后一个专题：那张卡是一个嵌套专题卡的 `<ul>`，外部提供方填充它的 `task-board.settings.section` 席位。兄弟提供方（GitHub Issues 同步）在同一席位里渲染 `PluginSettingsCard` 的 nested 密度——一张带边框的可折叠卡，有标题、内容内缩和用发丝线分隔的行。

团队区块渲染的却是一个裸 `<div>`，三个缺陷都由此而来：

- 它直接挂在 `<ul>` 下（不是合法的列表内容），自身没有任何卡片外壳，于是读起来像父卡片里的一段散落内容，而不是与兄弟卡片并列的专题。
- 它的行是手写的 `display: flex; justify-content: space-between`，里面放一个 `width: 100%` 的输入框。flex 行里的全宽输入框会吃掉整行，旁边的标签被压到最小内容宽度，按一两个字换行（`Hub 地址` 断成 `Hub 地` / `址`，`本地兜底等待（分钟）` 断成三行），并且每个输入框的起始 x 都不一样，控件列没有共同的左边界。
- 能力行是同样的 flex 行，右侧却是一整句长文案：标签断成两行、值也在旁边断成两行，两者交错成一段读不通的文本。

这些样式原本都写在本扩展自己的 CSS 模块里（`.section`、`.row`、`.input`），共享卡片切片也就无从纠正：这个区块从来没用过那张卡。

## Decision

`TeamSettingsSection` 渲染一张 nested 密度的 `PluginSettingsCard`，行是共享的字段网格。

- 卡片外壳（边框、背景、圆角、标题、折叠、内容内缩、两行之间的发丝线）一律来自家族切片，绝不来自本包的 CSS 模块。
- 每一行是一个 `.field`：标签在 head 列，提示在它下面，控件在尾列，并由切片自己的容器查询收窄——卡片宽度低于 440px 时控件落到文字下方，而不是去压文字。标签因此不会被控件挤压，控件也共享同一条左边界。
- 长说明是字段的 `hint`，不是控件区：不可用的能力把自己的名字留在标签行，原因在它下面，`不可用` 结论在尾列。
- 卡片默认收起，与兄弟提供方区块和看板自己的专题卡一致：设置页打开时是一份专题列表，提供方区块是其中一条。收起的卡片根本不挂载内容，读者不展开就零成本。
- 区块仍然经看板自己的动作通道写入（`setup-save`、`set-token`、`clear-token`、`refresh`），并保留自己的保存行：这张卡不持有暂存草稿，所以保存与放弃是空操作，被拒绝的写入由卡片页脚报告。
- `dsh-task-board-team` 进入 `scripts/sync-shared.mjs` 的共享卡片三件套消费方清单；五个生成副本（`settings-form.ts`、`PluginSettingsCard.tsx`、`settings-card.module.css`、`SegmentGroup.tsx`、`RangeBubble.tsx`）与其它消费方一样提交在包内。它刻意不复制 `settings-entry-form.ts`：它的字段经看板写入，不走家族设置命名空间。
- `@deepseek-ai/dsh-client-store` 进入本包的 devDependencies，供共享切片导入的类型解析。它不进入 `dsh.client.inject`：`PluginSettingsCard` 只以 type-only 导入 `CardShell`，该模块没有任何部分在运行时进入 bundle。

## Alternatives considered

保持区块自给自足、把卡片外壳抄进 `team.module.css` 被否决：它把卡片的边框、圆角、背景与内缩复制到第二处，家族卡片下一次变动就会把它落下。bundle 纯度规则本来就禁止通过 import 拿看板自己的卡片，而这个共享切片机制正是为此存在。

只修 flex 行、保留裸区块被否决：区块仍会以非法列表内容、无外壳的形态出现，专题列表里照样夹着一个没有卡片外观的条目。

去掉区块自己的保存行、改用卡片的暂存表单被否决：这些字段不是家族设置命名空间——Host Token 从不进入设置命名空间，其余部分经看板的动作通道写入——没有可暂存的 `CardForm`，硬加一个会把写入路径搬走。

## Consequences

团队区块在结构上与兄弟提供方卡片已经无从区分：同样的外壳、同样的行节奏、同样的控件列。

`dsh-task-board-team` 现在携带五个生成的客户端副本，它们禁止手改：改 `shared/client/settings/` 后跑 `node scripts/sync-shared.mjs`，由 `test:scripts` 守门。

Host Token 那一行现在是普通字段：状态词在标签旁，粘贴说明作为 hint；原长占位文案改为短键 `section.token.placeholderShort`，因为 220px 的控件会裁掉它。五个卡片词汇键（`settings.collapse`、`settings.expand`、`settings.notExposed`、`settings.readOnly`、`settings.saveFailed`）进入本包字典，并同步到 `dsh-i18n` 的俄语镜像。

## Testing

`pnpm --filter @linxin666/dsh-client-ui-task-board-team test`：11 个文件 94 个用例通过，含新增的 `tests/settings-card.spec.tsx`。它把区块渲染成静态标记，钉住这次缺陷的三个性质——根节点是专题列表里的一张卡、每一行都带共享字段类且不带手写行类、五个输入框各自绑定到自己的标签。

`typecheck` 与 `build` 通过；`pnpm i18n:check`、`pnpm docs:check` 与 `node scripts/sync-shared.mjs --check` 通过。

GUI 证据取自运行中的宿主，同一设置页、同一 1280x800 视口与主题：修复前区块在父卡片里无边框地悬着，`Hub 地`/`址` 与 `团队`/`ID` 断行，钉住预设那一行与它的结论交错；修复后它是一张标题为「团队协作」的带边框嵌套卡，标签单行、控件一列、能力原因在名字下方。同一组截图里兄弟的 GitHub 卡片外观不变。
