# Agent Note: maid-atelier 浅色模式 composer 文字对比度

Status: implemented

## 问题

Issue #1085：启用 maid-atelier（深海女仆工坊）皮肤并处于浅色模式时，在会话
输入框里打字看不清。composer 卡片刻意在明暗两种模式下都保持深海蓝蕾丝底色
（`patches.css` 无条件设置卡片背景，深色模式只做微调）。shell 实际通过卡片内
的高亮 backdrop div 绘制已输入文字（textarea 覆盖其上、`-webkit-text-fill-color`
透明，只贡献光标与选区；`[data-input-mirror]` 是 `visibility:hidden` 的测量副本），
而浅色模式的覆盖样式从未设置 backdrop 的颜色：它继承了浅色模式墨色 `#172347`，
深蓝字压在深蓝卡片上。浅色模式的光标（`#405a99`）与 placeholder（`#4d5d7f`）
存在同样的深压深缺陷。

## 决策

把 composer 卡片视为与明暗模式无关的深色表面，在
`packages/skins/skin-center/skins/maid-atelier/patches.css` 中为两种模式统一
固定浅色陶瓷系文字色：backdrop（与 mirror）文字 `#eef3fc`、光标 `#bcd2ff`、
placeholder `#b6c2e0`。删除了因而冗余的 `body[data-ds-dark-theme]` 光标与
placeholder 覆盖——深色模式此前生效的是等价的浅色值（backdrop 继承深色 body
墨色 `#e5eaf6`），统一后深色模式渲染不变、浅色模式修复。皮肤版本 0.3.0 升到
0.3.1；gallery manifest 与 market dist 在同一变更中重新生成。

被否决的替代方案：浅色模式下把 composer 卡片改为陶瓷白浅色卡片。那会消解皮肤
标志性的深海蓝蕾丝 composer——深蓝卡片加蕾丝边框艺术是两种模式共同的设计
主体，缺陷只是漏配了文字颜色。

## 影响

今后任何 composer 卡片背景改动都必须复查这组固定文字色，因为它们不再随模式
token 继承。已在运行中的 Web GUI（浅色模式，hero 与 dock 两种 composer 相位）
截图验证；深色模式渲染确认无变化。
