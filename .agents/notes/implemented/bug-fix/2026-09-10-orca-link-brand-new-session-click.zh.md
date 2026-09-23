# Agent Note: orca-link 宽侧栏把新建会话按钮变成了点击死角

Status: implemented

## Problem

orca-link 皮肤在展开（宽）侧栏下，点击左上角 DSH 字标区域没有任何反应。宿主把「新建会话」按钮放在侧栏 logo 行的第一个控件位置；皮肤隐藏了按钮自身的视觉，并在其上叠加 DSH 字标，因此这块字标区域是用户唯一能看到的新建会话入口——而它完全不可点。收起侧栏时一切正常，所以皮肤其余部分看起来毫无异常。

根因：`patches.css` 从 v2 移植之初就带着 `body[data-orca-sidebar-wide] [data-orca-link-brand] { pointer-events: none; }`。这条规则比它所适配的宿主布局活得更久：现在的宿主把「新建会话」按钮放在这一行，规则就把主操作从 UI 上悄悄切掉了。而它周围所有装饰层（字标、信号 chip）本来就是 `pointer-events: none`，都不是凶手。

## Decision

删除这条规则。brand 按钮在两种侧栏宽度下都保留宿主自身的点击语义（`aria-label="新建会话"`）；叠加在其上的皮肤 chrome 保持不可交互，整块字标区域因此命中按钮。附带效果：皮肤本来就在宽模式下为该按钮绘制的悬停反馈（`:hover:before` 舞台边框与角标）重新可以被触发——这正是设计为这个操作准备的反馈。

新增静态守卫（`tests/orca-link-hit-targets.spec.ts`）：orca-link 任何一张样式表若以 `pointer-events: none` 命中 `[data-orca-link-brand]`，测试即失败，同类命中面回归无法再从该选择器溜进来。

## Testing

- Live GUI（运行中的宿主，端口 3080，orca-link 生效）：带旧样式表时，字标中心 `elementFromPoint` 命中 logo 行 div，永远到不了按钮。换成修复后的样式表后，同一点命中按钮；先打开一个已有会话再点击字标，UI 回到 hero 新会话界面且侧栏选中「新会话」（已留截图）。
- 与按钮下缘重叠的价格灯保留悬停提示；它只遮挡命中区的几个像素。
- 新守卫用例与既有 `orca-link-hooks.spec.ts` 通过；`pnpm typecheck`、`pnpm test`、`pnpm docs:check`、`pnpm i18n:check`、`pnpm skin-center:check` 通过。

## Alternatives considered

- **把新建会话入口挪到别处。** 否决：位置与语义本就归宿主管；皮肤不应重建壳层 chrome。
- **保持该区域不可点击，避免误触新建会话。** 否决：用户明确期望点击即新建会话，且 hero 界面无破坏性；误触风险属于装饰边框（移动端误触 note 里已用 `:before` 上的 `pointer-events: none` 修掉），不属于按钮本身。
- **只给字标覆盖层恢复 pointer events。** 否决：覆盖层是行的子节点而非按钮的子节点；要让点击穿透它，按钮自身必须接受 pointer events，更窄的规则并不存在。

## Consequences

- 宽侧栏最大的固定入口恢复可用；修复随皮肤资产发布，已安装的皮肤在下一次皮肤更新或重装时生效（无需重启宿主——皮肤文件变更后刷新页面即可，已实测）。
- 守卫是文本层面的：若通过别的选择器写法（例如改名的属性）禁用 brand 按钮的 pointer events，守卫拦不住。该选择器由皮肤契约锁定，暴露面很小。
