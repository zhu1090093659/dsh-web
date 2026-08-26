# 深流（Deep Current）

[English](README.md) | 中文

深流为 dsh web GUI 注入海洋观测站气质：深海墨绿侧栏围住珍珠色工作区，有机的海底测绘等深线场聚拢在输入区周围。

## 能力

- **分层深度配色**：亮色主题以深色侧栏搭配珍珠画布；暗色主题整体下潜为低亮度深海配色。
- **横向海流标志**：本地创作的 SVG 海底测绘等深线场与柔和洋流带会在空会话首页以分层速度横向流过输入区；会话出现内容后即恢复静止，不会在消息正文下方持续运动。
- **最小结构补丁**：完整界面主要由 token 重映射承载，少量 CSS 补丁只使用结构数据、语义数据和 ARIA 属性；不含哈希类选择器或脚本。

## 安装

深流随 @linxin666/dsh-client-ui-skin-center 内置发布。安装皮肤中心，打开「设置 → 皮肤中心」，即可试穿或应用「深流」。

~~~sh
dsh plugin --profile web add @linxin666/dsh-client-ui-skin-center
~~~

## 配置

皮肤自动跟随 GUI 的亮暗主题，没有自己的配置项。皮肤中心总开关与全局背景控制仍然可用；操作系统要求减少动态效果时，首页海流动效会自动关闭。

## 预览

~~~sh
pnpm market:build
open market/dist/preview.html?skin=deep-current&theme=light
open market/dist/preview.html?skin=deep-current&theme=dark
node scripts/capture-previews deep-current
~~~

## 已知限制

- 纯呈现层：只改变浏览器样式，不触及模型请求或已存数据。
- 分色侧栏与输入区处理使用皮肤中心披露的高敏感 CSS 补丁入口，但范围仅限稳定的结构与语义属性。
- 等深线场随皮肤本地内置，不发起网络请求，也不使用第三方美术素材。
