# @linxin666/dsh-client-ui-web-ui-settings

[English](README.md) | 中文

面向 DSH 设置页的 dsh web UI 设置插件组：在 DSH 设置页注册一个一级菜单项（与通用设置 / 模式 / 插件 / Agent 预设同级），归组全家桶插件的启用开关与配置表单。

## 是什么

- **全家桶设置分区**：在 DSH 设置页注册一级菜单项，以静态标题和卡片归组其余 dsh web UI 全家桶插件（task-board、remote-web-ui、describe-image）。各插件卡默认折叠，独立展开后显示启用开关与配置表单。
- **一级设置分区**：皮肤中心、桌面宠物与「创意工坊」（商店卡片）各自作为一级设置分区注册，直接展开；官方「插件」分区内置安装器，插件管理 Tab 由 `dsh-plugin-manager` 提供。

## 安装

### 从 npm 安装（推荐）

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-web-ui-settings@latest
```

### 从仓库安装（开发调试）

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-web-settings
```

安装后重启 `dsh web`，设置页出现该菜单项。

## 配置

`trustedProxyHosts` 为空时，桥接仍仅限 loopback。认证反向代理与 DSH 运行在同一 Host 的部署，可以显式加入准确的 authority，并指定保存代理共享令牌的环境变量名：

```yaml
- id: ui-web-ui-settings
  config:
    trustedProxyHosts:
      - dsh.example.com
    proxyTokenEnv: DSH_WEB_UI_SETTINGS_PROXY_TOKEN
```

为 DSH 和反向代理设置该环境变量。请生成专用的高熵值，不要把令牌值写入 `cordis.patch.yml`。在认证处理完成后，先替换内部请求头，再把请求转发到仅监听 loopback 的 DSH。Caddy 的 upstream 部分如下：

```caddyfile
reverse_proxy 127.0.0.1:3080 {
    header_up X-Dsh-Web-Ui-Settings-Proxy-Token {$DSH_WEB_UI_SETTINGS_PROXY_TOKEN}
}
```

带值的 `header_up` 会覆盖客户端提供的同名请求头。不要再同时删除同一字段：Caddy 2.6 会在分组操作中先设置、后删除。如果 Caddy 的 systemd 单元以 `caddy run --environ` 启动，请去掉该参数或严格保护其输出，因为该参数会在启动时打印环境变量。

`settings.yaml` 中的 `web_settings_namespaces` 继续决定桥接开放哪些全家桶命名空间；未配置时使用内置全家桶列表。修改插件配置需要重启 DSH，`web_settings_namespaces` 则在每次桥接调用时重新读取。

## 安全模型

- 远程桥接默认关闭。直接访问仍与此前一致，同时要求 loopback socket 和 loopback Host。
- 认证代理访问要求 loopback socket、规范且已配置的 Host、浏览器同源请求，以及由代理向 upstream 注入的共享令牌。浏览器不会收到该令牌。
- 反向代理是认证边界：DSH 必须只监听 loopback，认证必须排在 `reverse_proxy` 之前，内部请求头必须由代理替换而不能透传客户端值。
- 桥接只开放已注册全家桶命名空间与 `web_settings_namespaces` 的交集，不开放凭据、本机路径或其他 DSH 特权 API。

## 故障排查

### "Failed to load plugins ... keyed slot `settings.plugin.item` requires options.key"（DSH 0.1.0-rc.6+）

0.1.17 及更早版本把组卡片注册进 keyed 槽 `settings.plugin.item` 时传的是 `id` 而不是必填的 `key`；DSH 0.1.0-rc.6 起在 loader entry 应用阶段直接拒绝这种注册，Web GUI 因此以 "Failed to load plugins" 启动失败。

0.1.18 起注册改到一级 `settings.section` 槽（list 槽，用 `id` 定位），0.2.0 已发布；`main` 上的代码与 rc.6 / rc.7 兼容。仍在报错的 profile 带的是冻结的旧安装：

1. 把 profile `package.json` 里所有 `@linxin666/*` 依赖升到 `^0.2.0`（至少 `^0.1.18`）。
2. 重装 profile 依赖（`pnpm install`）；Windows 下重建陈旧的 `node_modules/@linxin666/*` junction 链接（先 `cmd /c rmdir <链接>` 再 `cmd /c mklink /J <链接> <目标>`）。
3. 重启 `dsh web`。

参见 [issue #513](https://github.com/zhu1090093659/dsh-web/issues/513)。

## 已知限制

- 仅当依赖的 `@deepseek-ai/dsh-client-ui-settings` 存在时，该菜单项才会出现在 dsh 设置页。
- 认证代理模式本身不提供认证；没有正确配置并排序认证代理的部署必须让 `trustedProxyHosts` 保持为空。
- 兼容桥只服务 dsh-web 全家桶设置，不会让 DSH 官方设置或凭据平面可被远程访问。

## 数据遥测

浏览器半区每个 UTC 日向 dsh-market.com 发送一次匿名安装心跳：仅含一个 localStorage 随机 ID 与本包名，无其他数据。服务端只存储该 ID 的加盐哈希，不存 IP，且只暴露聚合计数。完整契约见 [docs/telemetry.md](../../docs/telemetry.md)。
