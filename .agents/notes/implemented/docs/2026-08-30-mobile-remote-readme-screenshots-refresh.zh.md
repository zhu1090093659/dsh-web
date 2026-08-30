# Agent Note: 根 README 移动端远程截图刷新为「复用官方界面」后的形态

Status: implemented

## Problem

根 README 的移动端远程小节仍挂着已移除的独立 /m 界面的四张截图（20-mobile-workspaces / 21-mobile-sessions / 22-mobile-chat / 23-mobile-model-sheet），并描述手机落在独立移动端界面。重建（[`remote-control-reuses-official-ui`](../../architecture/2026-08-29-remote-control-reuses-official-ui.md)）之后手机运行的是官方 Web GUI 加竖屏触控适配层，README 与交付行为不符。

## Decision

- 小节以产品方提供的合成图 `docs/assets/phone-and-web.png`（桌面 GUI 叠加手机界面）开场，随后才是四张重拍的移动端截图。
- 四张移动端截图对着运行中的 GUI（127.0.0.1:3080，未重启服务）以触控模拟 390x844 @2x 视口重拍；拍摄前已核实适配层生效（body`.dsh-remote-portrait`、鲸鱼按钮 `#dshRemoteWhale`、紧凑选择器、桌面工具面被抑制）。
- 新图组：`20-mobile-home.png`（鲸鱼入口 + 官方首页 + 输入器）、`21-mobile-sessions.png`（鲸鱼展开的侧边栏：工作区 + 会话）、`22-mobile-chat.png`（官方渲染的思考与工具调用）、`23-mobile-model-sheet.png`（模型选择底部弹层）；删除 `20-mobile-workspaces.png`。
- 根 README 双语把段落更新为当前状态：手机运行的就是官方 Web GUI 本身，竖屏下注入触控适配层（鲸鱼侧栏入口、滑动手势、长按菜单、Enter 换行、16px 输入框；桌面工具面自动隐藏）——与桌面同一份界面、同一份状态；英文镜像与截图表格标题同一改动内同步。
- 拍摄方式：headless Chromium（仓库 devDependency Playwright）携带从运行中 Chrome 读取的 127.0.0.1:3080 浏览器会话 cookie，用户可见的 Chrome 未被缩放或导航；临时脚本在 git-ignored 的 `test-results/shots/` 下，不属于本次改动。

## Alternatives considered

- 在用户可见 Chrome 里用 browser-use CDP 模拟手机视口：否决——设备指标覆盖会改变用户浏览器显示，且「复制 cookie 到隔离上下文」无需触碰它即可达成同样效果。
- 改拍桌面配对面板 / 二维码：未采纳——本小节保持四张手机截图，配对流程细节归插件 README 所有。

## Consequences

- 截图反映交付的适配后官方界面；下次官方客户端视觉变动可能再次过期，本次拍摄为一次性（暂无提交的复拍脚本）。
- `docs/screenshots/21/22/23` 沿用原文件名，`20` 由 workspaces 更名为 home；仓库内不再有对已删除文件的引用（git-ignored 的 marketing 宣传稿 DESIGN.md 未更新）。
