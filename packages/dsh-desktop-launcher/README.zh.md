# @linxin666/dsh-desktop-launcher

[English](README.md) | 中文

在桌面创建一个一键启动图标：双击图标启动 `dsh web`（未运行时），等待 GUI
就绪后自动打开浏览器到配置的地址。支持 Windows（.lnk）、macOS（.command）
与 Linux（.desktop）。

## 是什么

- 设置 → 插件配置 → Web 插件 卡片内有「创建桌面图标」按钮；host 把启动脚本
  写到 `~/.dsh/desktop-launcher/`，并把图标放到桌面。
- 双击行为：先探测 GUI 地址；已在响应则直接打开浏览器且不启动新进程；否则后台启动 `dsh web --no-open`（Windows 隐藏窗口），最多轮询 30 秒后由启动器只打开一个浏览器标签。关闭标签不会结束后台服务；需要退出 DSH 时使用页面内的关机按钮。找不到 `dsh` 命令时弹提示，而不是静默失败。
- 每次点按钮都会按当前设置重新生成启动脚本，因此 `dshCommand` / `url` /
  `profile` 修改后重新创建即生效，无需手动改图标目标。
- Windows 启动器与快捷方式安装脚本使用带 BOM 的 UTF-8 写出，兼容 Windows PowerShell 5.1 和非 ASCII 用户路径。命令解析优先选择 npm 的 `dsh.cmd`/可执行 shim，而不是 `dsh.ps1`；仅剩 PowerShell 脚本时会显式经 `powershell.exe` 调用，不触发系统文件关联。
- Windows 快捷方式使用 DeepSeek Harness 鲸鱼图标（白底），启动时弹出深色风格的「启动中」小窗代替黑窗：实时显示进度（启动 dsh、等待 GUI 就绪），失败时（找不到命令 / 超时）红字提示并提供「确定」按钮。

## 安装

### 从 npm 安装（推荐）

```sh
dsh plugin --profile web add @linxin666/dsh-desktop-launcher
```

### 从仓库安装（开发调试）

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install
pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-desktop-launcher
```

重启 `dsh web`，打开「设置 → 插件配置 → Web 插件」，先开启插件（默认关闭），再点「创建桌面图标」。

## 配置

所有字段都在插件设置卡片（或组合条目）中：

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `enabled` | `false` | 插件总开关；默认关闭。 |
| `announceToAgent` | `false` | 按需开启：开启后在系统提示词中公告本插件。 |
| `dshCommand` | `dsh` | 启动 dsh 的命令，需在 PATH 中。 |
| `url` | `http://127.0.0.1:3080` | 启动器等待就绪并打开的 GUI 地址。 |
| `profile` | 未设置 | 可选 profile；设置后使用 `dsh --profile <name> --no-open`，留空使用 `dsh web --no-open`。 |
| `iconPath` | 未设置 | 桌面图标的 .ico/.png 文件；留空使用内置的 DeepSeek Harness 图标。 |

## 安全模型

- host API 仅限 loopback：非本机地址、伪造 Host 头与跨源请求一律 403。关闭浏览器标签不会请求 host 退出；浏览器侧只有显式关机接口可以结束 DSH。
- 插件只写两处：`~/.dsh/desktop-launcher/`（启动脚本）与用户桌面目录（图标）。
- Linux 下创建图标时尽力用 `gio` 把 `.desktop` 标记为可信；没有 `gio` 的桌面
  环境图标仍会出现，但可能需要手动「允许启动」。

## 已知限制

- 启动器假设双击时 `dsh` 在 PATH 中；dsh 不在 PATH 时把 `dshCommand` 配成
  绝对路径。
- 30 秒就绪轮询是固定值；首次启动特别慢可能超时（启动器会弹提示）。
- 创建图标需要桌面目录；Windows 的 OneDrive 重定向桌面会被识别，其他重定向
  可能需要手动放置图标。

## 数据遥测

浏览器半区每个 UTC 日向 dsh-market.com 发送一次匿名安装心跳：仅含一个 localStorage 随机 ID 与本包名，无其他数据。服务端只存储该 ID 的加盐哈希，不存 IP，且只暴露聚合计数。完整契约见 [docs/telemetry.md](../../docs/telemetry.md)。

## 许可证

Apache-2.0。
