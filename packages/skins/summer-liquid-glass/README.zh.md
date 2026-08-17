# @linxin666/dsh-client-ui-skin-summer-liquid-glass

[English](README.md) | 中文

夏沫琉璃（Summer Liquid Glass）DSH Web GUI 皮肤 —— iOS 26 液态玻璃主题：
在日系夏祭插画之上叠加分层半透明玻璃表面（内缘高光、边缘折射、扩散阴影、
顶部光泽），配深海军蓝可读性遮罩；冰青作主要交互、玫瑰粉作选中与品牌、
琥珀金作运行中、黄绿作成功。

以官方独立 bundle 形态热插拔为客户端插件：`apply()` 设置
`data-dsh-summer-liquid-glass` body 属性（整张样式表的作用域），以深海军蓝
遮罩绘制 WebP 背景（锚定上方居中的人物面部），注入液态玻璃 favicon，并跟踪
指针实现轻微面板光泽；其 effect disposer 收回全部写入。样式表由 bundle 的
CSS-modules 自动注入。主题仅深色：亮/暗基础模式下应用同一套调色板。

皮肤纯呈现层：不注入服务、不发出 cordis 事件、不触及模型请求。

## 使用教程

1. 打开 DSH Web GUI → 设置 → 皮肤中心。
2. 找到「夏沫琉璃」（Summer Liquid Glass），点卡片试穿。
3. 一键应用；或用命令行切换：`dsh-skin use summer-liquid-glass`。
4. 恢复默认：`dsh-skin use official`（或皮肤中心的「官方」）。

同一时间只有一个皮肤生效；切换热重载，刷新页面即可看到。

## 调色板

深夜底 `#071321`、玻璃基底 `#111927`、主文字 `#F8F3F5`、次级 `#C0CAD5`、
弱化 `#8997A7`；冰青 `#67DCE7` 交互、玫瑰粉 `#DD8FAC` 选中/品牌、琥珀金
`#F3B75F` 运行中、黄绿 `#CBE77D` 成功、珊瑚红 `#F1717F` 错误。

## 安装（官方 bundle）

1. 本地路径：`dsh plugin --profile <name> add /path/to/dsh-web-ui/packages/skins/summer-liquid-glass`
2. Git：`dsh plugin --profile <name> add github:<org>/dsh-web-ui#<sha>`
3. 用 `scripts/dsh-skin` 切换（`dsh-skin use summer-liquid-glass`）；同一时间只有一个皮肤生效。

## 构建与测试

```sh
pnpm build   # tsdown：lib/index.js + lib/client.js（自包含预设）
pnpm test    # vitest：apply/dispose 契约测试
```

## 发布到皮肤中心

```sh
node scripts/skin-center-bundles
pnpm --filter @linxin666/dsh-client-ui-skin-center build
node scripts/gallery-build
node scripts/capture-previews
```

然后提交全部产物并发 PR。

## 许可证

BSD-3-Clause。背景插画由用户提供、仅限本地使用；发布前请重新核查再分发权利。
