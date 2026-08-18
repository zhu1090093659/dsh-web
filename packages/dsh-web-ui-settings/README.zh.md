# @linxin666/dsh-client-ui-web-ui-settings

[English](README.md) | 中文

面向 DSH 设置页的 dsh web UI 设置插件组：在 DSH 设置页注册一个一级菜单项（与通用设置 / 模式 / 插件 / Agent 预设同级），归组全家桶插件的启用开关与配置表单。

## 是什么

- **全家桶设置分区**：在 DSH 设置页注册一级菜单项，以静态标题和卡片归组其余 dsh web UI 全家桶插件（task-board、remote-web-ui、describe-image）。各插件卡默认折叠，独立展开后显示启用开关与配置表单。
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

## 已知限制

- 仅当依赖的 `@deepseek-ai/dsh-client-ui-settings` 存在时，该菜单项才会出现在 dsh 设置页。
- 认证代理模式本身不提供认证；没有正确配置并排序认证代理的部署必须让 `trustedProxyHosts` 保持为空。
- 兼容桥只服务 dsh-web-ui 全家桶设置，不会让 DSH 官方设置或凭据平面可被远程访问。
