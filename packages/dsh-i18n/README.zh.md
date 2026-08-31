# dsh-i18n

[English](README.md) | 中文

dsh Web GUI 的语言包插件：向 Web GUI 语言目录注册 Русский（俄语），并集中承载全部家族插件命名空间的 ru 字典，让外部翻译贡献者能在一处翻译与维护俄语文案。

## 是什么

本插件是纯浏览器 bundle（host 半区刻意无任何行为），每次页面加载运行一次：

- 通过 `ctx.locale.addLanguage` 向共享语言目录注册语言定义 `ru`（标签 `Русский`，回退 `en`），语言因此出现在官方 `Settings -> General -> Language` 行中可选。
- 通过单语言非 typed 的 `ctx.locale.register(ns, 'ru', dict)` 为每个覆盖的命名空间注册一份 ru 字典，在各包自己的 zh/en 注册之外贡献第三语言，不改动那些包。
- 字典查找按键走 SDK 回退链 ns -> common -> en -> key：本包未覆盖的命名空间或键显示英文，不会残留中文。
- 本插件没有自己的设置项，也不渲染任何 UI。

### 覆盖的命名空间

| 命名空间 | 来源包 |
| --- | --- |
| `desktop-launcher` | dsh-desktop-launcher |
| `doctor` | dsh-doctor |
| `git-graph` | dsh-git-graph |
| `dsh-web-ui-market` | dsh-market |
| `dsh-perf` | dsh-perf |
| `pet` | dsh-pet |
| `settings.pluginManager` | dsh-plugin-manager |
| `remote` | dsh-remote-web-ui |
| `session-id` | dsh-session-id |
| `dsh-skill-explorer` | dsh-skill-explorer |
| `dsh-ssh` | dsh-ssh |
| `task-board` | dsh-task-board |
| `describe-image` | dsh-tool-describe-image |
| `dsh-web-ui-usage` | dsh-usage |
| `web-ui-plugins` | dsh-web-settings |

## 安装

需要 DSH 0.1.2-alpha.2 或更高版本：插件针对 0.1.2-alpha.2 DSH cohort 开发，其
`@deepseek-ai/*` 运行时服务由宿主自身提供。

在你的 profile（如 `~/.dsh/profiles/web`）中执行：

```sh
dsh plugin --profile web add @linxin666/dsh-i18n
```

或从仓库检出安装：

```sh
dsh plugin --profile web add link:<repo>/packages/dsh-i18n
```

本插件也在 dsh-web-all 聚合包内，安装聚合包的 profile 会自动携带。安装或更新
bundle 后需重启 `dsh web`；页面重新加载后语言即出现。

## 配置

无：本插件没有设置键，也没有设置卡。语言选择在官方 locale 界面
（`Settings -> General -> Language`）完成。

## 已知限制

- 官方外壳命名空间（`common`、`settings.locale`）不在本包范围内，DSH 外壳本身
  保持其自带 zh/en，家族插件则渲染俄语。
- 来源包新增或修改 zh 键时，必须在本包镜像对应的 ru 键；`pnpm i18n:check`
  强制键集一致，缺键即红。
- 若其他语言包已先定义 `ru` id，本包的语言定义让位（字典注册继续）；已被他人
  注册的命名空间保留原属主的字典。
- 字符串内的占位符名（`{count}`、`{time}` 等）与 zh/en 共用，必须原样保留；
  占位符周边的语法别扭请反馈，不要改动占位符名。

## 许可证

Apache-2.0。
