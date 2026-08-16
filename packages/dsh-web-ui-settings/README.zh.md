# @linxin666/dsh-client-ui-web-ui-settings

[English](README.md) | 中文

面向 DSH 设置页的 dsh web UI 设置插件组：在 DSH 设置页注册一个一级菜单项（与通用设置 / 模式 / 插件 / Agent 预设同级），归组全家桶插件的启用开关与配置表单。

## 是什么

- **全家桶设置分区**：在 DSH 设置页注册一级菜单项，内容直接展开（静态标题 + 卡片列表，无折叠层），归组其余 dsh web UI 全家桶插件（task-board、live-stats、remote-web-ui、describe-image）的启用开关与配置表单。
- **同级分区**：皮肤中心、社区插件与桌面宠物各自是独立插件包，注册自己的设置页一级菜单项并直接展开。

## 安装

### 从 npm 安装（推荐）

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-web-ui-settings
```

### 从仓库安装（开发调试）

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-web-ui-settings
```

安装后重启 `dsh web`，设置页出现该菜单项。

## 已知限制

- 仅当依赖的 `@deepseek-ai/dsh-client-ui-settings` 存在时，该菜单项才会出现在 dsh 设置页。
