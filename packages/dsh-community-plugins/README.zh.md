# @linxin666/dsh-client-ui-community-plugins

[English](README.md) | 中文

面向 dsh web GUI 设置页的社区插件索引分区：作为一级菜单项（与 Web UI 插件、皮肤中心、宠物同级）直接展开，列出社区贡献的插件并链接到每位贡献者自己的仓库，配有自己的启用开关。

## 功能

- **一级菜单项**：在设置页注册一个一级分区，与通用设置 / 模式 / 插件 / Agent 预设以及 Web UI 插件、皮肤中心、宠物同级；内容直接展开（无折叠层），自带启用开关，由 community-plugins 设置命名空间持久化。
- **只做索引**：每个条目链接到贡献者自己的仓库；本包不打包任何被索引的代码。注册表在 community.json，由 scripts/community-index 编译进客户端 bundle。

## 安装

### 从 npm 安装（推荐）

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-community-plugins
```

### 从仓库安装（开发调试）

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-community-plugins
```

安装后重启 `dsh web`，设置页出现该卡片。

## 配置

- **启用开关**：位于「社区插件」一级分区自身（分区卡片自带的开关）。关闭后隐藏索引列表，重新打开即恢复；选择持久化在 community-plugins 设置命名空间。
- **运行已登记的插件**：索引只登记、不安装代码。每个条目显示安装命令（已发布 npm 用包名，否则用贡献者仓库地址），在终端执行即可，如 `dsh plugin --profile web add <包名>`。安装后，插件自带的开关与配置（若有）出现在插件配置区。

## 已知限制

- 仅当依赖的 `@deepseek-ai/dsh-client-ui-settings` 存在时，该卡片才会出现在 dsh 设置页。
- 条目由维护者在 community.json 中登记审核，卡片展示构建时的快照。

## License

BSD-3-Clause。
