# Agent Note: 宠物气泡字号跟随精灵缩放

Status: implemented

## Problem

issue #1549：状态、碎碎念与用量气泡被固定为 `font-size: 12px`，内边距与最大宽度同样是固定值。用户把宠物从默认 160px 缩到 100px 后，气泡仍保持原尺寸，比例上头重脚轻；而 `PetDisplayConfig` 里没有任何排版字段可以纠正。

## Decision

`PetDisplayConfig` 新增 `bubbleScale`（0.5–2，默认 1），与其它显示字段一样持久化并夹取——加载时在 `persist.ts`，两条写入路径在 `service.ts`，并声明进设置 schema 以便卡片编辑。`bubbleScaleFor(display)` 把尺寸与倍率折算成一个 CSS 比例 `(size / 160) * bubbleScale`，由 `BUBBLE_FONT_MIN_PX`（10）与 `BUBBLE_FONT_MAX_PX`（24）夹住，并四舍五入到两位小数，保证同一份配置永远渲染同一个结果。

`PetSprite` 把这个比例写成浮动容器上的 `--pet-bubble-scale`，`pet.module.css` 用它乘以气泡字号、内边距以及状态气泡的最大宽度（原有的 `calc(100vw - 24px)` 视口保护仍留在 `min()` 里）。于是宠物默认就会缩放自己的气泡，倍率在其上叠加，字号始终待在可读区间内。

## Alternatives considered

直接用像素的 `bubbleFontSize`：否决。那等于把气泡钉死在某个尺寸，对其它宠物尺寸重现同一个缺陷，而这正是被报告的问题。

只跟随尺寸、不给用户旋钮：否决。报告者明确希望能纠正结果，而气泡是宠物主要的文字表面。

在「跟随宠物」与「锁定尺寸」之间做开关：否决，那会多出一个需要解释的状态；一个叠在自动跟随之上的倍率已经覆盖两种读法，且不需要模式。

只缩放字号而保持内边距与状态宽度不变：否决。气泡会在更小的文字周围保留旧的外框，看起来松散而非成比例。

## Consequences

既有安装行为不变（默认倍率为 1，160px 宠物仍是 12px 文字）。缩小的宠物现在还会得到按比例变窄的状态气泡，因此较长的状态文案会比以前更早折行；两种情况下文字都以省略号截断。`bubbleScale` 属于设置 schema，因此设置卡片运行旧版本构建的部署也必须接受这个字段。
