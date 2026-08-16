# @linxin666/dsh-client-ui-community-plugins

[English](README.md) | 中文

面向 dsh web GUI 的 API 驱动社区插件管理器：现有「社区插件」一级设置分区从 DSH 插件市场实时目录浏览项目，并管理当前 Web profile 中兼容的项目。同一个包还会注册市场工具和随包 Skill，供对话内调用。

## 功能

- **保留现有一级分区**：继续使用 `ui-community-plugins` Cordis 条目和 `community-plugins.enabled` 设置命名空间。分区与 Web UI 插件、皮肤中心、宠物同级，打开后直接展开。
- **实时目录**：从 [DSH 插件市场 API](https://api.dshmk.com/) 加载项目元数据、筛选项、验证证据和可执行计划状态。搜索、筛选、排序和刷新均使用 API 数据；刷新失败时保留上一次成功目录。
- **Profile 生命周期**：把市场条目与当前 Web profile 的直接依赖进行比对，并提供安装、更新和卸载操作。操作成功后需要重启 DSH Web。
- **对话集成**：注册 `store_catalog`、`store_search`、`store_details`、`store_installed`、`store_install` 和 `store_remove`，并随包提供 `search-dsh-store` Skill。写操作工具执行前进入 DSH 审批流程。

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

重启 `dsh web`，挂载设置分区、生命周期路由、工具和 Skill。

## 配置

- **启用开关**：关闭「社区插件」只会隐藏市场 UI，不会停用或移除已经安装的项目；选择仍保存在 `community-plugins.enabled`。
- **UI 操作**：选择 API 项目，检查识别出的确切计划，确认第三方代码风险后执行。只有当前 Web profile 的直接依赖能与市场条目匹配时，才会显示更新和卸载操作。
- **对话使用**：让 Agent 搜索、查看、安装、更新或卸载市场项目。读取工具可直接运行；安装、更新和卸载必须经过明确的 DSH 审批。

## 安全模型

- API 元数据按不可信内容处理。浏览器安装时只提交仓库 ID；Host 会重新获取当前 API 响应，并校验项目身份、固定 CLI 参数和受支持来源后再执行。已验证的 GitHub 计划必须绑定 API 验证 SHA。
- 写操作使用官方 native-command runner 和固定参数数组，不经过 shell。本地 HTTP 写路由要求 loopback 与同源请求并串行执行；对话写工具使用 DSH 审批门。
- 市场验证状态只是兼容性证据，不代表安全审查、质量保证或官方背书。安装前仍需检查第三方代码和权限。

## 已知限制

- 设置分区依赖 `@deepseek-ai/dsh-client-ui-settings`，市场目录需要能访问 `https://api.dshmk.com/`。
- 没有受支持可执行 API 计划的项目可以浏览，但不能通过本包安装。
- 已安装和更新状态仅覆盖能够匹配市场 npm 或 GitHub 来源的 Web profile 直接依赖。
- 安装、更新和卸载需要在重启 DSH Web 后生效；本包不会自动重启进程。

目录数据与收录规则由 [ZASENJC/dsh-plugins-store](https://github.com/ZASENJC/dsh-plugins-store) 维护；本仓库不保存第二份目录快照。

## License

BSD-3-Clause。
