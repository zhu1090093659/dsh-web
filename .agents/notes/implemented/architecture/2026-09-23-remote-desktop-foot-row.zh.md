# Agent Note: 远程插件适配宽栏桌面底栏

Status: implemented

扩展 [远程控制复用官方界面](2026-08-29-remote-control-reuses-official-ui.md)：本插件的 shell 适配不再只限竖屏——宽栏桌面底栏由同一套语义后缀 CSS 层负责布局。

## Problem

官方侧栏底栏是两行堆叠：`sidebar.footer.action`（更新与远程触发器）在上，`sidebar.settings`（横跨整列的「设置」触发器）在下。于是在桌面宽栏里，「设置」触发器独占一整行、右半边全是空白，而本属同一簇的两个触发器却另占一行。用户要求这三个控件共用一行。

## Decision

1. `remote.module.css` 把宽栏底栏排成一个可换行的行，并以未折叠框架为作用域（`[data-dsh-frame]:not([data-sidebar-collapsed])`）：设置座位开启该行（`order: 1`、`flex: 1 1 auto`），底部动作座位占据行尾（`order: 2`、`flex: none`），于是「设置」触发器与动作对共用一行，「设置」触发器收窄到留给它的宽度。
2. 其余任何脚部子节点——用量速览卡、其它插件的块——在该行之上各占一整行（`flex: 1 1 100%`），因此共享行无需知道有哪些插件会追加子节点也保持稳定。
3. 折叠框架的栏轨保持官方原有的堆叠脚部：这些规则在 `[data-sidebar-collapsed]` 下一律不生效——栏轨按设计把圆形图标堆叠，56px 的列也放不下共享行。

## Alternatives considered

- 用绝对定位把触发器叠到设置行上。否决：设置触发器仍是整行宽（而宽度正是被投诉的点），且位置依赖设置座位恰为脚部最后一个子节点。
- 把底部动作节点搬进设置行。否决：该节点的位置归槽渲染器所有；在 React reconciliation 之下重新挂载 DOM 正是用量速览卡通过自持 React 根来规避的坑。
- 放到用量插件里做（它的卡片本来就在脚部）。按归属否决：触发器属于本包，而且该布局在未安装用量插件时也必须成立。
- 不做栏轨作用域、无条件共享一行。否决：官方栏轨是 56px 的列，共享行会溢出并裁掉两个圆形图标。

## Consequences

- 桌面宽栏下「设置」触发器不再独占一行，更新与远程触发器与之并列；栏轨不受影响。
- 布局依赖官方后缀类 `footArea` / `settingsArea` / `footerActions` 与框架上的 `data-sidebar-collapsed` 标记——与竖屏层相同的存活契约，每轮官方 GUI 升级都要重新视觉 QA。
- 任何向脚部追加块的插件都自动获得一整行；想让自己的块加入共享行的插件需要接受同样的 order/basis 契约。

## Testing

- `packages/dsh-remote-web-ui/tests/foot-row-css.spec.ts`：宽栏行的方向与换行、设置座位的伸展与 order、动作座位的行尾位置、其他脚部子节点的整行规则，以及每条规则的折叠框架作用域。
- 真机：宽栏下「设置」触发器与动作对同处一行，设置触发器实测宽 182px（原 260px），用量卡在其上一行；栏轨保持 `flex-direction: column` 且动作图标仍堆叠。
