# @linxin666/dsh-client-ui-skin-qq2006

[English](README.md) | 中文

一款受 QQ2006 桌面客户端启发的轻量 dsh Web GUI 皮肤。它提供紧凑的蓝色窗口框、浅色状态栏、经典桌面控件和水晶蓝配色，无需修改 DSH 官方源码。

本皮肤只负责呈现。客户端入口设置一个有作用域的 body 属性，并加入两条窗口栏和一个 data URL favicon；生命周期清理器会撤回全部写入。小企鹅标记是代码内原创 SVG，不包含腾讯图片、音频、字体或其他二进制素材。

## 安装

推荐安装皮肤聚合包，也可以只链接本皮肤：

```sh
dsh plugin --profile web add link:$(pwd)/packages/dsh-skins
# 或者
dsh plugin --profile web add link:$(pwd)/packages/skins/qq2006

dsh-skin use qq2006
```

本地 `link:` 安装前，请先在仓库根目录运行 `pnpm install && pnpm -r build`。同一时刻只会启用一个皮肤。

## 模型体验

无。本包只改变浏览器 DOM 与 CSS，不组装或发送任何模型请求。

## 已知限制

- 皮肤在插件 bundle 加载后才生效，因此最早的加载界面仍保持官方外观。
- 它有意实现轻量的视觉演绎，不会逐像素复制专有 QQ 界面或行为。
