# 战争雷霆 · 钢铁前线（War Thunder Frontline）

[English](README.md) | 中文

以战争雷霆（War Thunder）游戏美术为灵感的军事主题皮肤——游戏内登录背景、
橄榄军绿磨砂面板与官方星徽琥珀强调色，以纯资产目录形态内置在皮肤中心包内。
可读性优先：三主列保持近不透明，对话文字不与画作打架；战场氛围透过
框架边缘与主题遮罩透出。

## 是什么

- **纯资产**：`skin.json`（v2 清单）、`skin.css`（L1 token 重映射，
  亮色值挂在 `:root`、暗色值挂在 `body[data-ds-dark-theme]`）、
  `patches.css`（L3 组件补丁）、`hooks.mjs`（favicon、钉住标题、
  主题换图、视差背景、按住透视）、`assets/`（背景与星徽）与
  `preview/`（画廊截图）。无 package.json、无构建步骤；
  皮肤中心包是唯一加载器。
- **双主题画作**：亮色主题配明亮的日间战斗登录背景，暗色主题配夜战背景；
  两者在 `contributes.backgroundMedia` 声明，由皮肤中心绘制加可读遮罩。
  hooks 订阅主题翻转并就地换图（控制器只在激活时安装当刻变体）。
- **可读性**：三主列用近不透明橄榄 token；面板上刻意不用
  backdrop-filter（过滤祖先会成为 fixed 定位后代的包含块，把设置对话框
  等浮层困在列内）。外层框架保持透明，画作绕列可见。
- **按住透视**：按住 **Alt** 键——整层磨砂玻璃（侧栏、对话区、详情、
  输入区）一起淡向透明，战场显现；松开恢复。
- **透视视差**：按住透视期间，108% 超扫画作随指针轻微漂移（钳制在
  超扫边距内，CSS 过渡缓动）；未透视时画作静止，松开后缓动归中。
- **调色板**：亮色为橄榄纸 + 墨 + 琥珀，暗色为近黑橄榄石 + 琥珀；
  琥珀金强调色（`#d9a441`）贯穿按钮与选区。

## 预览

```sh
pnpm market:build                              # 刷新市场产物（market/dist）
open market/dist/preview.html?skin=war-thunder&theme=light
node scripts/capture-previews war-thunder    # 重拍 preview/{light,dark}.png
```

## 素材与许可

背景美术取自本机 War Thunder 游戏客户端登录页素材（只读解包），星徽取自
客户端 launcher.ico。所有素材版权归 Gaijin Entertainment 所有，仅用于
个人非商业用途；皮肤本体代码随仓库许可。详见 `skin.json` 的 `license`
与 `attribution` 字段。

## 已知限制

- 纯呈现层：只改浏览器样式，不触及模型请求。
- 无窗口 chrome（不做自定义标题/状态栏）：v1 的横条会盖住 shell
  自己的页眉页脚，v2 只保留 favicon、钉住标题与实时背景换图。
- 透视由 Alt 键触发/停止，无按住点击——按钮、链接与输入区等常规交互
  完全不受影响。
