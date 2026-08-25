# Agent Note: wallpaper-exclusive 原生排队卡铬层

Status: implemented

## Problem

原生排队卡（dsh-client-ui-conversation 中 QueueDock 渲染的 `data-queue-dock` 元素）在 conversation.input.dock 槽位内叠出两层盒子：根元素的类名包含 `_dock`，因而吃到皮肤输入卡材质，其水平内边距在内容四周读作一圈光晕；内层 panel 自绘近实底的 `--dsw-specific-tip` 填充、仅顶部圆角，并带一个 ::after 底部高光，在输入卡上方读作一条明亮接缝。wallpaper-exclusive 激活时，排队消息渲染成三层可见图层而不是一层。

## Decision

wallpaper-exclusive 补丁把这一栈叠收敛到单一表面。`[data-queue-dock]` 根元素去掉背景、backdrop filter 与圆角，光圈随之消失。内层 panel 接收输入卡材质（`--dsw-wallpaper-glass-fill`、固定 10px 模糊、完整 12/8px 圆角），排队行保留可读的磨砂衬底。panel 的 ::after 接缝高光被隐藏。同一变更中，皮肤把外壳 composer 配件 token 组（`--dsh-composer-accessory-*`）钉为纯磨砂值（透明填充、无边框、无圆角、无阴影），挂入 dock 的配件表面因此裸浮，不再重新引入盒状铬层。由于空闲态发送也会在队列状态中途经数帧，dock 通过延迟关键帧动画淡入，瞬态挂载期间完全不渲染；composer 卡上的短过渡则把 Task0 铬层切换变成交叉淡化。

## Testing

gallery:check、market:check 与 skin-center:check 通过；gallery 样式包与 market dist 资产在同一变更中重建。实机验证路径：皮肤激活时排队一条消息，确认输入卡上方只有一个玻璃盒，无光晕环亦无接缝线。

## Alternatives considered

只把 panel token（`--dsw-specific-tip`)调向半透明之所以落败，是因为光晕来自既有 `_dock` 规则施加在根层的材质而非 panel 颜色本身，且全局 token 重映射会泄入该 token 的无关消费方。对全部 `_dock` 子元素删除根层材质之所以落败，是因为 chat-recovery 等插件 dock 确实需要输入卡衬底保证文字可读；更窄的 `[data-queue-dock]` 属性锚点把例外范围限定在原生组件上。只依赖未来的 `--dsh-composer-accessory-*` 契约之所以落败，是因为当前安装的 shell 构建尚未发射或消费这些 token；显式选择器在当前与后续 shell 上都能工作。

## Consequences

排队卡渲染为恰好一个紧裹行内容的磨砂盒。若上游 shell 之后把 QueueDock 移出 input.dock 槽位，属性锚点仍让规则生效；若 `data-queue-dock` 属性被改名或移除，则需要重新锚定。上一轮的 `[data-phase="active"]` 门条件从未匹配任何已发布的 shell 构建，已作为死代码移除；若未来 shell 重新引入按阶段划分的属性，再回头评估锚点。入场延迟使短于约 200ms 的挂载保持不可见，极快发送流程因此完全看不到排队反馈——该窗口内本无用户可见事件，予以接受。
