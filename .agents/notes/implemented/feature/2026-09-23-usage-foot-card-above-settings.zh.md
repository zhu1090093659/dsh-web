# Agent Note: 用量速览卡移到「设置」行上方

Status: implemented

取代 [用量侧栏速览卡](2026-09-23-usage-sidebar-foot-card.md) 中「落位」的一半决定：卡片仍是那张 DOM 挂载的速览卡，但改为紧邻「设置」行**上方**，不再落在其下方。

## Problem

已上线的卡片挂在侧栏地板、设置行下方：它是脚部唯一自带边框与底色的元素，相对 shell 给动作行与设置行的网格偏了 2-6px，折叠态高 29px 而设置行 42px，并且压在惯例上作为侧栏末端锚点的条目之下。用户反馈这个位置有问题。

## Decision

1. `foot-card-mount.tsx` 把容器插进底栏、紧邻设置座之前，因此脚部顺序是动作图标、用量速览、设置，「设置」保持在最末。自愈跟随锚点（`container.nextElementSibling === settingsArea`），当 shell 不再暴露设置区时回落到底栏末位。
2. 卡片改用 shell 的行走几何，而不是卡片外壳：无边框、12px 圆角、shell 的行悬停底色（`--dsw-alias-interactive-bg-hover`）、8px 内边距，折叠摘要条最小高度 36px。只有展开体保留一层极淡的底色，因为它承载四行内容。

## Alternatives considered

- 保持设置下方不动、只做样式微调。否决：被投诉的正是位置本身；卡片留在设置下方会让「设置」不再位于侧栏地板。
- 注册进 `sidebar.footer.action`（动作行内）。否决：展开态是四行块，36px 的图标行放不下。
- 折叠条内联进动作行、展开时在别处变成块。否决：随状态搬位置会让控件在光标下移动，并让挂载逻辑翻倍。

## Consequences

- 「设置」重新成为底部锚点；用量速览读起来是脚部原生的一行，而不是贴在脚部的卡片。
- 卡片失去带边框的卡片外壳；展开体只靠一层淡底色与周围分隔。
- README 中英对、包描述与速览卡 Note 的落位事实随本次改动同步。

## Testing

- `packages/dsh-usage/tests/foot-card-mount.spec.tsx`：紧邻设置座上方落位、卡片与设置之间插入节点后的自愈、整栏重建后的重新锚定、重复挂载空操作、dispose，以及设置导航重放。
- `packages/dsh-usage/tests/foot-card.spec.tsx`：内容规则与折叠态的消费提供方命名。
- 真机证据记录在交付报告中。
