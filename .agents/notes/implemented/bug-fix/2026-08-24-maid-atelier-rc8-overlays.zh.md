# Agent Note: maid-atelier rc.8 附件与浮层兼容

Status: implemented

## 问题

DeepSeek Harness rc.8 通过 `conversation.input.attachments` Slot 渲染草稿
附件，并通过 Portal Menu 渲染设置选择器。maid-atelier 的 composer 边框创建了
高于深层附件分支的层叠上下文，因此即使 `blob:` 预览已经解码、删除按钮也可见，
缩略图仍被华丽卡框覆盖。皮肤的侧边栏装饰还会让会话代码块标题绘制在设置模态框
之上。把整个侧边栏提升到无限大的 z-index 虽能暂时消除该症状，却会让设置面板
反过来压住 DSH 的 Portal 菜单，导致 Agent 预设与权限选择器无法点击。Cordis
审批按钮也受到同一类侧边栏祖先层级与命中目标冲突影响。

## 决策

修复保留在 `packages/skins/skin-center/skins/maid-atelier/patches.css` 中，
复用 DSH 既有浮层尺度，而不是发明更大的层级。完整附件 Slot 分支只在 composer
内部提升到装饰框上方，所有 CSS Module 后备选择器都锚定在
`[data-slot="conversation.input.attachments"]` 之下。Cordis 进入普通菜单层级
（必要侧边栏上下文为 `80`、面板为 `100`）。设置进入模态层级（侧边栏祖先为
`900`、全屏 presentation 层为 `1000`），从而保留 DSH 官方 Portal Menu 的
`1100` 位于模态框之上。图标子节点不再截获审批按钮指针事件，实际操作按钮仍可
命中。

内置皮肤验收测试锁定附件 Slot 作用域、模态层级以及自定义数值 z-index 最大为
`1000`。皮肤版本从 `0.3.1` 升到 `0.3.2`，使 Workshop 安装能收到这些兼容修复。

## 考虑过的替代方案

曾测试把设置与 Cordis 祖先提升到 `214748xxxx`，但予以否决。它虽然能压住代码块
装饰并让审批圆形按钮可见，却破坏了宿主的 `modal 1000 < portaled Menu 1100`
契约，导致设置面板内的控制项无法打开可用菜单。

也测试过只提升附件 `<img>`，同样予以否决。子元素无法逃出父元素较低的层叠
上下文，因此浏览器虽报告 `blob:` 图片已经加载，华丽 composer 边框仍会覆盖它。

## 影响

今后 maid-atelier 针对生成式 CSS Module 类名的兼容选择器必须位于语义 Slot 或
插件锚点之下；模态修复必须保留宿主浮层尺度，不能使用无限大的 z-index。修复已在
运行中的 DSH Web GUI 验证：附件缩略图可见、设置选择器可点击、设置模态框高于
Markdown 代码块标题、Cordis 审批按钮可用。
