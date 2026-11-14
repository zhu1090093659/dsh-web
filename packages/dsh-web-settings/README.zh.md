# dsh-web-settings · DeepSeek Harness (DSH) Web GUI 偏好设置增强与外观管理插件

[English](README.md) | 中文

<p align="center">
  <img src="https://img.shields.io/npm/v/@linxin666/dsh-client-ui-web-ui-settings?style=flat-square" alt="Version">
  &nbsp;
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.2--rc.3-4c6ef5?style=flat-square&amp;labelColor=454a54" alt="DSH">
  &nbsp;
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>DeepSeek Harness（DSH）官方 Web GUI 与桌面客户端统一偏好设置与插件配置中心</strong><br>
  <em>全家桶设置分区 · 原生表单通道桥接 · 旧版设置无损迁移 · 界面外观与交互微调 · 模块化卡片槽位</em>
</p>

面向 DSH 设置页的 dsh web UI 设置插件组：在 DSH 设置页注册「Web 扩展」一级菜单项，归组扩展管理页、全家桶插件的启用开关与配置表单。

## 是什么

- **统一 Web 扩展分区**：稳定的一级 `web-ui-plugins` 入口以二级 TAB 承载 Web 插件、皮肤、宠物、创意工坊和使用统计。Web 插件 TAB 归组其余 dsh web UI 家族卡片（task-board、remote-web-ui 等），各卡独立展开后显示启用开关与配置表单。
- **独立安装回退**：父级包缺席时，皮肤中心、桌面宠物、创意工坊与使用统计保留各自原一级设置入口；官方「插件」分区内置安装器，插件管理 Tab 由 `dsh-plugin-manager` 提供。
- **家族插件不依赖本分组**：本包声明家族卡片注册的 list 槽 `web-ui.plugin.item`。本包已加载时家族插件注册进该槽；本包缺席时改注册官方插件管理页的 keyed 槽 `plugins.bundle.config`（以自身 bundle 包名为 key），因此只装家族插件、未装本分组的 profile 同样能触达每张卡片。
- **原生设置通道**：0.1.7 的设置面以 profile entry id 定位每个配置表单。Host 侧桥接按 profile 行反查各全家桶命名空间所属的 entry id，并在 describe 响应里回传；浏览器半区据此绑定原生共享表单（`ctx.configForms`）。无法解析 entry id 的页面才退回 loopback HTTP 通道。

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

`settings.yaml` 中的 `web_settings_namespaces` 继续决定桥接开放哪些全家桶命名空间；未配置时使用内置全家桶列表。Host 首次启动时会一次性导入 `settings.yaml` 并重命名为 `settings.yaml.imported`，因此桥接依次读取该改名文件、0.1.7 之前的旧文档，只有在文件名确实指向设置文档时才把 Host 上报的 profile patch 当作设置文档。修改插件配置需要重启 DSH，`web_settings_namespaces` 则在每次桥接调用时重新读取。

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

浏览器半区每个 UTC 日向 dsh-market.com 发送一次匿名安装心跳：仅含一个 localStorage 随机 ID 与本包名，无其他数据。服务端只存储该 ID 的加盐哈希，不存 IP，且只暴露聚合计数。

「Web 插件」页顶部「通用」分组里的遥测开关一次性关闭全家桶心跳：默认开启，所以开关入页即为开，关掉才停止上报；偏好存在 localStorage 的 `dsh-web-ui-telemetry-opt-out` 键。浏览器发出 Do Not Track 时心跳同样自行停止，此时开关仍如实表示本机保存的偏好，这一行会说明这一点。无论开关如何，创意工坊、插件安装与在线更新照常可用。完整契约见 [docs/telemetry.md](../../docs/telemetry.md)。
