# Whale-chan Harness 鲸鱼娘

[English](README.md) | 中文

Whale-chan Harness 为 dsh web GUI 提供海洋蓝社区同人视觉：Whale-chan 骑鲸品牌标志贯穿主界面，并为工作区、文件、Harness 内置工具、控制按钮、权限、会话和子代理提供专属美术。

## 能力

- **统一的 Whale-chan 身份**：侧边栏与空会话品牌位使用骑鲸徽标，浅色和暗色界面通过官方 dsh token 映射获得清晰的海洋蓝配色。
- **功能优先的图标系统**：工作区与文件导航、Harness 内置工具、输入区操作、权限等级和活动状态均使用专属图标，并在 16–24 px 下保留熟悉且可辨识的 UI 轮廓。
- **本地角色背景**：亮暗模式在半透明界面后提供克制的 Whale-chan 运维场景，不加载远程媒体。
- **纯声明式激活**：皮肤只包含本地 CSS 和图片资产；皮肤中心统一负责选择器作用域、资源路径校验、试穿、应用、持久化与卸载。

## 安装

Whale-chan Harness 通过 dsh 创意工坊分发。安装皮肤中心后，在「设置 → 创意工坊」安装该皮肤，再进入「设置 → 皮肤中心」试穿或应用 Whale-chan Harness。

~~~sh
dsh plugin --profile web add @linxin666/dsh-client-ui-skin-center
~~~

## 配置

皮肤自动跟随 GUI 亮暗主题，没有自己的配置项。皮肤中心总开关与全局背景控制仍然可用。

## 预览

~~~sh
pnpm market:build
open market/dist/preview.html?skin=whalechan-harness&theme=light
open market/dist/preview.html?skin=whalechan-harness&theme=dark
node scripts/capture-previews whalechan-harness
~~~

## 安全模型

皮肤不发起网络请求，也不执行脚本。图片与样式全部本地内置，所有资源引用均限制在皮肤目录内，激活只改变界面呈现。

## 已知限制

- 精细图标替换使用皮肤中心披露的高敏感 CSS 补丁入口，并保留若干生成类名选择器；dsh 前端重新构建后可能需要维护选择器。
- 用户目录版与创意工坊版均不包含客户端 Hooks，因此不具备独立安装版的动态文本打标；标准权限菜单仍使用声明式顺序回退。
- 美术属于 CC BY-NC-SA 4.0 下的非官方非商业社区同人作品；署名与第三方权利说明记录在 `NOTICE` 和 `LICENSE` 中。
