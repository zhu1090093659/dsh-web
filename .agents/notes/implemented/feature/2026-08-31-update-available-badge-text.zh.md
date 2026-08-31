# Agent Note: 侧边栏自动更新入口检测到新版本时展示文字徽标

Status: implemented

## 问题

此前 `dsh-remote-web-ui` 插件在侧边栏渲染检查更新与远程控制入口。当后台检测到新版本发布（`updateAvailable === true`）时，仅在下载图标右上角渲染一个红/主题色小圆点（`::after` 徽标），视觉提示较弱且不够直观。

## 决策

- **更新徽标文字展示**：当后台检测到新版本时，在侧边栏更新触发按钮内追加展示「有更新」文字标签（`update.badge` 词条）。
- **宽栏与窄栏自适应（Wide vs Rail）**：
  - **宽栏展开模式（`wide === true`）**：按钮自适应扩展为胶囊药丸型（Pill，`border-radius: 999px`，`flex: none; width: auto; padding: 0 10px; gap: 6px;`），图标与文案并排展示，隐藏浮动小圆点避免视觉干扰；
  - **窄栏折叠模式（`wide === false`，56px 导轨）**：保持 36px 圆形按钮几何形状，隐藏文字标签，保留右上角圆点角标，不破坏 56px 侧边栏导轨排版。
- **多语言（i18n）**：
  - 中文（`zh`）：`'update.badge': '有更新'`
  - 英文（`en`）：`'update.badge': 'Update available'`
  - 俄文（`ru`）：`'update.badge': 'Есть обновление'`（同步 `packages/dsh-i18n/src/client/ru/remote-web-ui.ts`）。

## 备选方案

- 仅依靠 hover `title` / tooltip：用户不把鼠标悬停在按钮上时无法获知更新信息，提示效果较弱。
- 在窄栏下也强行显示文字：会导致 56px 导轨宽度被撑破或文字溢出裁切，破坏响应式布局。

## 后果

- 用户在侧边栏展开状态下能一眼识别到有新版本可用，点击即可呼出更新面板确认并执行更新。
- 窄栏与宽栏切换平滑自适应，圆角与尺寸符合 `#1035` 统一几何家族规范。
