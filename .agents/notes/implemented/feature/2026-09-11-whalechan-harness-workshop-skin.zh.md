# Agent Note: Whale-chan Harness 创意工坊皮肤

Status: implemented

## Problem

Whale-chan Harness 社区主题以独立静态前端覆盖层分发，皮肤中心用户无法通过创意工坊发现、试穿、应用或卸载该主题。

## Decision

创意工坊目录以声明式 Skin Center v2 资产目录收录 `whalechan-harness`，其中包含本地图片资产、亮暗 token 配色与角色背景、高敏感 CSS 补丁、双语用户文档、预览图，以及明确的 CC BY-NC-SA 4.0 署名。

该皮肤不声明客户端 Hooks。精细图标替换保留在 `patches.css`，皮肤中心统一负责选择器作用域、路径校验、激活、持久化与卸载。

## Compatibility boundary

当目标图标没有稳定语义或 ARIA 锚点时，补丁层保留生成类名选择器。皮肤中心会对此给出兼容性警告；官方前端重新构建后可能需要维护这些选择器，但不会使清单或声明式回退配色失效。

## Testing

皮肤通过 `node scripts/dsh-skin validate packages/skins/skin-center/skins/whalechan-harness`。市场与皮肤中心生成器会收录新的目录条目，并校验其本地资产、清单、样式表、预览图和文档。

## Alternatives considered

只在独立仓库保留主题可以避免资产重复，但会失去皮肤中心的试穿、原子激活、目录诊断和创意工坊发现能力。

增加 `hooks.mjs` 可以复现独立版按权限文本动态打标的行为，但可执行皮肤 facet 需要更严格的审核身份，而且主要视觉结果并不依赖它；标准权限菜单可由声明式顺序回退覆盖。

只保留 token 重映射可以消除生成类名警告，但也会舍弃定义该主题的 Whale-chan 专属图标系统。

## Consequences

创意工坊用户通过常规皮肤生命周期获得主题，不需要修改 `index.html`。由于皮肤包含全部被引用的栅格资产，市场包体积会增加。官方前端重新构建后，维护者需要重新验证生成类名选择器。
