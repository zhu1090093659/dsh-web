# Agent Note: 侧栏启动入口组的稳定语义锚点

Status: implemented

## Problem

皮肤不能通过本地化后的无障碍名称安全选择侧栏的新会话操作。`button[aria-label="New session"]` 这类选择器在中文以及未来任何其他语言中都会静默失效，而官方 shell 目前尚未为该操作输出专用 slot 或语义 part。云轨舱窗的启动入口软枕还依赖固定 256px 宽度与 shell wrapper 层级，因此可能在 Gallery facade 中消失，或在侧栏缩放、折叠时越界。

## Decision

Skin Center 的 L2 兼容适配器在官方 `button[class*="newSession"]` 缝上补打 `data-dsh-part="new-session"`。该值归 `semantic-attrs/v1` 契约所有，皮肤只选择语义 part；本地化文案只承担无障碍职责，不作为样式 API。Gallery 与 Workshop 预览 facade 在挂载官方 shell 快照后补打同一 part，使预览行为与真实 Skin Center 运行时一致。云轨舱窗把覆盖三行的单张软枕锚定到稳定的任务看板入口，继承入口行宽度，让入口内容绘制在装饰图之上，并在侧栏折叠时隐藏装饰图。最后一行入口通过少量底部间距为软枕收边留位，不选择或装饰 Workspace 区域。

## Alternatives considered

- 保留英文 `aria-label` 并追加各语言变体：否决，因为每增加一种语言或修改一次文案都需要更新皮肤，漏配时还会静默失效。
- 只按兄弟节点顺序或已注入插件入口的存在关系选择按钮：否决，因为侧栏组成与插件安装顺序不是新会话操作自身的属性。
- 仅在云轨舱窗皮肤的 hook 中补属性：否决，因为社区皮肤默认是纯资产包，语义契约属于 Skin Center 而不是某个皮肤。
- 让软枕继续挂在 shell wrapper 上并固定为 256px：否决，因为 wrapper 深度不是皮肤契约，固定图片盒也无法跟随入口宽度与折叠状态。

## Consequences

- 皮肤可通过一个有文档记录的选择器，在中文、英文和其他语言中一致地装饰该操作。
- 在官方 shell 输出一方语义属性前，适配器内部仍依赖当前 shell 的 class seam；该依赖被隔离在单条规则中，上游缝落地后即可删除。
- 运行时测试使用中文无障碍名称证明补标不依赖本地化文案，预览 facade 同步暴露该契约以提供视觉证据。
- 软枕会随入口行缩放，并在折叠 rail 中消失；入口自身预留的间距让收边避开 Workspace，但不会给 Workspace 区域应用皮肤样式。
