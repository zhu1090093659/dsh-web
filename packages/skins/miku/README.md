# dsh-client-ui-skin-miku · 初音未来主题皮肤

为 DeepSeek Harness（DSH）Web GUI 打造的初音未来（Hatsune Miku）主题皮肤。

- **配色**：蓝紫洋红渐变（#2e9bff → #9b5dff → #ff4da6）贯穿标题栏与按钮
- **毛玻璃**：半透明面板、侧边栏、输入框、设置弹窗，背景透出
- **自定义背景图**：内置示例背景，可替换为你自己的初音图片
- **亮/暗双主题**：亮色为蓝粉晴空，暗色为霓虹蓝紫夜
- **电子歌姬元素**：顶部 01 编号徽标、音符图标、状态栏音乐波形

![亮色](preview/light.png) · ![暗色](preview/dark.png)

## 特性

- 纯呈现层：不注入服务、不发事件、不触模型请求
- `apply()` 只写自己会收回的东西，disposer 完整回收（body 属性、注入元素、favicon、标题）
- 样式全部挂在 `body[data-dsh-miku]` 下（暗色变体 `[data-ds-dark-theme]`）
- 无静态资源文件：背景图以 data URI 内嵌

## 环境要求

- Node.js ≥ 20
- pnpm ≥ 9
- 已运行 `dsh web` 的 DSH 环境（默认 `http://127.0.0.1:3080`）

## 构建与测试

```bash
pnpm install     # 安装依赖（自动执行 prepare 构建）
pnpm build       # 构建 lib/index.js + lib/client.js
pnpm test        # apply/dispose 契约测试
```

构建产物 `lib/` 已随仓库提交，克隆后即使跳过构建也可安装；但建议完整构建一次。

## 安装到 DSH

```bash
dsh plugin --profile web add "link:<本仓库绝对路径>"
```

- 路径含空格（Windows）：`dsh plugin add` 会把含空格的参数拆断，请改用：

  ```bash
  cd ~/.dsh/profiles/web
  pnpm add "link:<本仓库绝对路径>"
  ```

  然后把 `@linxin666/dsh-client-ui-skin-miku` 追加到
  `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 数组。

- 安装后重启 `dsh web`，强制刷新页面（Ctrl+Shift+R）。

## 切换皮肤

皮肤启用互斥，通过 `scripts/dsh-skin` 管理（写入 `~/.dsh/cordis.patch.yml` 的 managed 区段 + profile 链接）：

```bash
dsh-skin use miku       # 启用本皮肤
dsh-skin use official   # 恢复官方默认外观
dsh-skin list           # 查看皮肤与当前激活项
```

切换后 config watcher 会在几秒内热重载，刷新页面即可生效。

## 自定义背景图

背景图在 `src/client/art.ts` 的 `MIKU_ART` 常量中（data URI）。

替换方式：把你喜欢的图片放到本仓库（例如 `bg.png`），然后执行：

```bash
node scripts/embed-bg.mjs  # 将 bg.png 转成 WebP 并写入 art.ts（如无此脚本请手动转 base64）
```

或用任意工具把图片转成 base64 后替换 `MIKU_ART` 的值：

```ts
export const MIKU_ART = 'data:image/webp;base64,<...>'
```

重新构建后刷新页面即可。

## License

BSD-3-Clause
