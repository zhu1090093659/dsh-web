# dsh-desktop-launcher — Windows 启动弹窗验证快照

> 一次性验证记录，供 PR 的用户可见变更证据参考；不属长期文档。

## 变更内容

新增 `packages/dsh-desktop-launcher`（桌面一键启动图标插件）。Windows 启动器
`launcher.ps1` 从黑窗 / `WScript.Shell.Popup` 升级为深色 WPF「启动中」弹窗：

- 内置 DeepSeek Harness 鲸鱼图标（白底，`assets/dsh.ico` + `assets/dsh.png`）。
- 居中无边框弹窗：标题 + 旋转指示器 + 状态/详情文本 + 「确定」按钮（失败时显示）。
- 流程：探测 GUI 地址 → 找到 `dsh` → 显示弹窗 → 后台启动 `dsh web --profile` →
  轮询就绪（60s）→ 打开浏览器关闭弹窗；`dsh` 缺失 / 超时 → 红字状态 + 「确定」。
- 桌面图标文件名规范化：`DeepSeek-Harness.lnk` / `.command` /
  `deepseek-harness.desktop`；Linux `.desktop` 条目引用复制到
  `~/.dsh/desktop-launcher/` 的 PNG 图标。
- `launcher.ps1` 仅 Windows 写出 UTF-8 BOM（PS 5.1 中文文本无 BOM 会乱码）；
  POSIX 脚本不写 BOM（避免破坏 shebang 直接执行）。

## 验证方式与证据

本机 agent 会话为无人值守 console，GDI `CopyFromScreen` 无法捕获重叠 WPF 窗口，
截图不可用。改用进程级确定性证据：

- 运行 `error/launcher.ps1`（`dshCommand` 指向不存在命令）时
  `$popup.Show()` 执行并进入 `while ($popup.IsVisible)` 等待循环、随后
  `exit 1`；进程存活、32 线程（WPF Dispatcher 已启动）。关键执行帧
  （`Set-PSDebug -Trace 1` 输出）：

  ```
  92:  $popup = [System.Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $popupXaml))
  110: $detailText.Text = $detail
  112: $popup.Show()
  113: while ( $popup.IsVisible) {
  121: exit 1
  ```

- `tests/` 断言：win32 launcher.ps1 以 BOM 开头；linux launcher.sh 不以 BOM
  开头；PNG 图标复制到 `~/.dsh/desktop-launcher/` 并被 `.desktop` 条目引用；
  文件名（`.lnk`/`.command`/`.desktop`）断言。

## 门禁

`typecheck` / `test`（24 passed） / `build` / `docs:check` / `aggregate --check`
/ `runtime-deps-check` 全绿。
